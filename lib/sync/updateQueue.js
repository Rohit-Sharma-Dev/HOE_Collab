/**
 * UpdateQueue — persists pending Yjs binary updates across page refreshes.
 *
 * When the client is offline, outgoing Yjs updates are queued here.
 * On reconnect, SupabaseSyncProvider drains this queue and pushes
 * all accumulated updates to Supabase.
 *
 * Storage: localStorage (keyed by docId) so the queue survives
 * navigation and browser restarts. IndexedDB holds the full Yjs
 * state; this queue only holds the *outgoing* delta updates.
 */

const PREFIX = "collab_queue_";

/**
 * Serializes a Uint8Array to a base64 string for localStorage storage.
 */
function encodePayload(uint8array) {
  let binary = "";
  const len = uint8array.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8array[i]);
  }
  return btoa(binary);
}

function decodePayload(base64) {
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

export class UpdateQueue {
  constructor(docId) {
    this.key = PREFIX + docId;
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(this.key);
      this.items = raw ? JSON.parse(raw) : [];
    } catch {
      this.items = [];
    }
  }

  _save() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.items));
    } catch {
      console.warn("UpdateQueue: localStorage write failed (quota exceeded?)");
    }
  }

  /**
   * Enqueue a new Yjs update payload (Uint8Array).
   */
  enqueue(uint8array) {
    this.items.push({
      payload: encodePayload(uint8array),
      timestamp: Date.now(),
    });
    this._save();
  }

  /**
   * Returns all queued items as Uint8Arrays, oldest first.
   */
  getAll() {
    return this.items.map((item) => decodePayload(item.payload));
  }

  /**
   * Clears all queued items after successful flush.
   */
  clear() {
    this.items = [];
    this._save();
  }

  get size() {
    return this.items.length;
  }

  get isEmpty() {
    return this.items.length === 0;
  }
}
