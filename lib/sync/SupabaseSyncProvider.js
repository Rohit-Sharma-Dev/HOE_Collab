import * as Y from "yjs";
import { UpdateQueue } from "./updateQueue";

/**
 * SupabaseSyncProvider — Custom Yjs provider for Supabase.
 *
 * Responsibilities:
 *  1. On mount: fetch the merged Yjs state from `documents.yjs_state`
 *     and all unapplied `sync_updates` since that state, apply them.
 *  2. On Y.Doc update: encode the binary delta, push to Supabase
 *     (or queue if offline), emit status events.
 *  3. Subscribe to Supabase Realtime for new sync_updates from other
 *     clients; apply them incrementally to the local Y.Doc.
 *  4. Fallback: poll every few seconds if Realtime isn't available.
 *  5. On reconnect (window 'online' event): drain the offline queue.
 *  6. Emit status changes: 'offline' | 'syncing' | 'synced' | 'online'
 *
 * This provider does NOT use y-webrtc — all sync goes through
 * Supabase Postgres + Realtime, providing a single source of truth.
 */
export class SupabaseSyncProvider {
  /**
   * @param {Y.Doc} ydoc
   * @param {string} docId - UUID of the document
   * @param {string} clientId - Stable UUID per browser session
   * @param {import('@supabase/supabase-js').SupabaseClient} supabase
   * @param {function} onStatusChange - (status: string, pendingCount: number) => void
   */
  constructor(ydoc, docId, clientId, supabase, onStatusChange) {
    this.ydoc = ydoc;
    this.docId = docId;
    this.clientId = clientId;
    this.supabase = supabase;
    this.onStatusChange = onStatusChange || (() => {});
    this.queue = new UpdateQueue(docId);
    this.channel = null;
    this._destroyed = false;
    this._isSyncing = false;
    this._lastSyncedAt = null; // ISO timestamp of last seen update
    this._realtimeConnected = false;
    this._pollInterval = null;
    this.appliedUpdateIds = new Set();

    this._onUpdate = this._onUpdate.bind(this);
    this._onOnline = this._onOnline.bind(this);
    this._onOffline = this._onOffline.bind(this);
  }

  /**
   * Start the provider: fetch initial state, subscribe to realtime, attach listeners.
   */
  async connect() {
    if (this._destroyed) return;

    this._emitStatus("syncing");

    // 1. Fetch merged state from document row
    await this._hydrate();

    // 2. Attach Y.Doc update listener
    this.ydoc.on("update", this._onUpdate);

    // 3. Subscribe to Realtime for live collaboration
    this._subscribeRealtime();

    // 4. Start polling as fallback (stops if Realtime connects)
    this._startPolling();

    // 5. If we were offline and have a queue, drain it now
    if (!this.queue.isEmpty) {
      await this._drainQueue();
    } else {
      this._emitStatus("synced");
    }

    // 6. Listen to window online/offline events for connection recovery
    if (typeof window !== "undefined") {
      window.addEventListener("online", this._onOnline);
      window.addEventListener("offline", this._onOffline);
    }
  }

  /** Fetch the base Yjs state from Supabase and apply sync_updates on top. */
  async _hydrate() {
    try {
      const serverDoc = new Y.Doc();

      // Get merged base state
      const { data: doc, error: docErr } = await this.supabase
        .from("documents")
        .select("yjs_state")
        .eq("id", this.docId)
        .single();

      if (docErr) {
        console.warn("SupabaseSyncProvider: failed to fetch document", docErr.message);
      }

      if (doc?.yjs_state) {
        try {
          const state = this._decodePayload(doc.yjs_state);
          if (state && state.length > 0) {
            Y.applyUpdate(serverDoc, state);
            Y.applyUpdate(this.ydoc, state, "supabase");
          }
        } catch (err) {
          console.warn("SupabaseSyncProvider: failed to apply base yjs_state", err);
        }
      }

      // Fetch incremental updates
      let query = this.supabase
        .from("sync_updates")
        .select("id, update_payload, client_id, created_at")
        .eq("document_id", this.docId)
        .order("created_at", { ascending: true });

      const { data: updates, error } = await query;

      if (error) {
        console.warn("[SyncProvider] Failed to fetch sync_updates", error.message);
      } else if (updates?.length) {
        for (const row of updates) {
          this.appliedUpdateIds.add(row.id);
          try {
            const payload = this._decodePayload(row.update_payload);
            if (payload && payload.length > 0) {
              Y.applyUpdate(serverDoc, payload);
              Y.applyUpdate(this.ydoc, payload, "supabase");
            }
          } catch (err) {
            console.warn("[SyncProvider] Failed to apply sync_update during hydration", row.id, err);
          }
          this._lastSyncedAt = row.created_at;
        }
      }

      // Compute two-way diff: what does local ydoc have that the server is missing?
      const serverStateVector = Y.encodeStateVector(serverDoc);
      const localDiff = Y.encodeStateAsUpdate(this.ydoc, serverStateVector);

      const isEmptyUpdate =
        localDiff.length === 0 ||
        (localDiff.length === 1 && localDiff[0] === 0) ||
        (localDiff.length === 2 && localDiff[0] === 0 && localDiff[1] === 0);

      if (!isEmptyUpdate) {
        console.log(`[SyncProvider] Found ${localDiff.length} bytes of local edits missing on server. Pushing.`);
        await this._pushUpdate(localDiff);
      }
    } catch (err) {
      console.error("SupabaseSyncProvider: hydration failed", err);
    }
  }

  /**
   * Fetch sync_updates from Supabase and apply to Y.Doc.
   * Used by polling fallback.
   */
  async _fetchAndApplyUpdates() {
    try {
      let query = this.supabase
        .from("sync_updates")
        .select("id, update_payload, client_id, created_at")
        .eq("document_id", this.docId)
        .order("created_at", { ascending: true });

      // If we have a last synced timestamp, only fetch newer updates
      // Subtract 5 seconds to ensure we do not miss updates due to database precision/rounding
      if (this._lastSyncedAt) {
        const date = new Date(this._lastSyncedAt);
        date.setSeconds(date.getSeconds() - 5);
        query = query.gt("created_at", date.toISOString());
      }

      console.log(`[SyncProvider] Fetching updates... lastSyncedAt = ${this._lastSyncedAt}`);
      const { data: updates, error } = await query;

      if (error) {
        console.warn("[SyncProvider] Failed to fetch sync_updates", error.message);
        return;
      }

      console.log(`[SyncProvider] Fetched ${updates?.length || 0} updates from DB.`);

      if (updates?.length) {
        let applied = 0;
        for (const row of updates) {
          // Deduplicate updates by ID
          if (this.appliedUpdateIds.has(row.id)) {
            continue;
          }
          this.appliedUpdateIds.add(row.id);

          // Skip updates we authored (already in our local Y.Doc via IndexedDB)
          if (row.client_id === this.clientId) {
            console.log(`[SyncProvider] Skipping own update: ${row.id}`);
            this._lastSyncedAt = row.created_at;
            continue;
          }
          try {
            const payload = this._decodePayload(row.update_payload);
            if (payload && payload.length > 0) {
              console.log(`[SyncProvider] Applying update: ${row.id} (len: ${payload.length})`);
              Y.applyUpdate(this.ydoc, payload, "supabase");
              applied++;
            } else {
              console.log(`[SyncProvider] Payload empty or null for update: ${row.id}`);
            }
          } catch (err) {
            console.warn("[SyncProvider] Skipping bad sync_update", row.id, err);
          }
          this._lastSyncedAt = row.created_at;
        }
        if (applied > 0) {
          this._emitStatus("synced");
        }
      }
    } catch (err) {
      console.error("[SyncProvider] Fetch updates failed", err);
    }
  }

  /** Called whenever the local Y.Doc changes. */
  async _onUpdate(update, origin) {
    // Don't re-push updates that came from Supabase (avoid echo)
    if (origin === this || origin === "supabase") return;

    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

    if (isOffline || !this.queue.isEmpty) {
      this.queue.enqueue(update);
      this._emitStatus("offline");
      if (!isOffline) {
        this._drainQueue();
      }
      return;
    }

    await this._pushUpdate(update);
  }

  /** Push a single binary update to Supabase sync_updates. */
  async _pushUpdate(update) {
    if (this._destroyed) return;
    this._emitStatus("syncing");

    try {
      const { data, error } = await this.supabase
        .from("sync_updates")
        .insert({
          document_id: this.docId,
          update_payload: this._encodePayload(update),
          client_id: this.clientId,
        })
        .select("created_at")
        .single();

      if (error) throw error;
      if (data?.created_at) {
        this._lastSyncedAt = data.created_at;
      }
      this._emitStatus("synced");
    } catch (err) {
      console.error("SupabaseSyncProvider: push failed", err);
      // Re-queue on failure
      this.queue.enqueue(update);
      this._emitStatus("offline");
      // Try draining later
      this._drainQueue();
    }
  }

  /** Drain all queued offline updates on reconnect. */
  async _drainQueue() {
    if (this._isSyncing || this.queue.isEmpty) return;
    this._isSyncing = true;
    this._emitStatus("syncing");

    const updates = this.queue.getAll();
    let allSucceeded = true;
    let lastCreatedAt = null;

    for (const update of updates) {
      try {
        const { data, error } = await this.supabase
          .from("sync_updates")
          .insert({
            document_id: this.docId,
            update_payload: this._encodePayload(update),
            client_id: this.clientId,
          })
          .select("created_at")
          .single();
        if (error) throw error;
        if (data?.created_at) {
          lastCreatedAt = data.created_at;
        }
      } catch (err) {
        console.error("SupabaseSyncProvider: drain failed for update", err);
        allSucceeded = false;
        break;
      }
    }

    if (allSucceeded) {
      this.queue.clear();
      if (lastCreatedAt) {
        this._lastSyncedAt = lastCreatedAt;
      }
      this._emitStatus("synced");
    } else {
      this._emitStatus("offline");
    }

    this._isSyncing = false;
  }

  /** Subscribe to Supabase Realtime for live sync_updates. */
  _subscribeRealtime() {
    this.channel = this.supabase
      .channel(`doc:${this.docId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sync_updates",
          filter: `document_id=eq.${this.docId}`,
        },
        (payload) => {
          const row = payload.new;
          // Skip our own updates
          if (row.client_id === this.clientId) return;
          try {
            const update = this._decodePayload(row.update_payload);
            if (update && update.length > 0) {
              Y.applyUpdate(this.ydoc, update, "supabase");
              this._lastSyncedAt = row.created_at;
              this._emitStatus("synced");
            }
          } catch (err) {
            console.error("SupabaseSyncProvider: failed to apply realtime update", err);
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("SupabaseSyncProvider: Realtime connected ✓");
          this._realtimeConnected = true;
          this._emitStatus(this.queue.isEmpty ? "synced" : "syncing");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("SupabaseSyncProvider: Realtime failed, using polling fallback");
          this._realtimeConnected = false;
          this._startPolling();
        } else if (status === "CLOSED") {
          this._realtimeConnected = false;
        }
      });
  }

  /**
   * Polling fallback: fetch new updates every 3 seconds.
   * Active when Supabase Realtime is not connected.
   */
  _startPolling() {
    if (this._pollInterval || this._destroyed) return;
    this._pollInterval = setInterval(() => {
      if (!this._destroyed) {
        this._fetchAndApplyUpdates();
      }
    }, 3000);
  }

  _stopPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  _onOnline() {
    this._drainQueue();
    // Also fetch any updates we missed while offline
    this._fetchAndApplyUpdates();
  }

  _onOffline() {
    this._emitStatus("offline");
  }

  _emitStatus(status) {
    this.onStatusChange(status, this.queue.size);
  }

  /** Cleanly tear down: unsubscribe, remove listeners. */
  destroy() {
    this._destroyed = true;
    this._stopPolling();
    this.ydoc.off("update", this._onUpdate);
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this._onOnline);
      window.removeEventListener("offline", this._onOffline);
    }
  }

  // ── Encoding helpers ────────────────────────────────────────────────────────
  // Supabase REST API returns bytea as base64.
  // Supabase Realtime (postgres_changes) returns bytea as hex (\x...).
  // We must handle both on decode, and encode reliably without stack overflow.

  /**
   * Encode a Uint8Array to base64 for Supabase BYTEA insert.
   * Uses a loop instead of String.fromCharCode(...spread) to avoid
   * "Maximum call stack size exceeded" for large Yjs updates.
   */
  _encodePayload(uint8array) {
    let binary = "";
    const len = uint8array.length;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8array[i]);
    }
    return btoa(binary);
  }

  /**
   * Decode a Supabase BYTEA value back to Uint8Array.
   * Handles:
   *  - base64 strings (from REST API SELECT)
   *  - hex strings with \x prefix (from Realtime postgres_changes)
   *  - double-encoded base64-in-hex strings (from legacy/unrefreshed clients)
   *  - null/undefined (returns null)
   */
  _decodePayload(value) {
    if (value == null || value === "") return null;

    if (typeof value !== "string") {
      console.warn("SupabaseSyncProvider: unexpected payload type", typeof value);
      return null;
    }

    let bytes = null;

    // Hex format from Supabase Realtime/REST: \x48656c6c6f
    if (value.startsWith("\\x")) {
      const hex = value.slice(2);
      bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
      }
    } else {
      // Base64 format from REST API
      try {
        const binary = atob(value);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
      } catch (err) {
        console.warn("SupabaseSyncProvider: base64 decode failed", err);
        return null;
      }
    }

    if (!bytes) return null;

    // Detection for legacy double-encoded base64-in-hex format.
    // If the bytes represent a valid base64 ASCII string, decode it.
    let isBase64 = bytes.length >= 4 && bytes.length % 4 === 0;
    if (isBase64) {
      for (let i = 0; i < bytes.length; i++) {
        const c = bytes[i];
        const isValid =
          (c >= 65 && c <= 90) ||   // A-Z
          (c >= 97 && c <= 122) ||  // a-z
          (c >= 48 && c <= 57) ||   // 0-9
          c === 43 || c === 47 || c === 61; // +, /, =
        if (!isValid) {
          isBase64 = false;
          break;
        }
      }
    }

    if (isBase64) {
      try {
        let base64Str = "";
        for (let i = 0; i < bytes.length; i++) {
          base64Str += String.fromCharCode(bytes[i]);
        }
        const binary = atob(base64Str);
        const finalBytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          finalBytes[i] = binary.charCodeAt(i);
        }
        return finalBytes;
      } catch {
        // Fall back to original bytes if base64 decode fails
      }
    }

    return bytes;
  }
}
