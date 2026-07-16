import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";

/**
 * Remaps local IndexedDB database and localStorage update queue from a
 * temporary offline ID (tempId) to a real database-generated ID (realId).
 *
 * @param {string} tempId
 * @param {string} realId
 */
export async function remapOfflineDocument(tempId, realId) {
  return new Promise((resolve, reject) => {
    console.log(`[OfflineSync] Remapping ${tempId} -> ${realId}`);
    const tempDoc = new Y.Doc();
    const tempPersist = new IndexeddbPersistence(`collab-doc-${tempId}`, tempDoc);

    tempPersist.once("synced", () => {
      try {
        // Instantiate real persistence with the hydrated doc;
        // this automatically writes the entire doc state to the new IndexedDB
        const realPersist = new IndexeddbPersistence(`collab-doc-${realId}`, tempDoc);

        realPersist.once("synced", () => {
          // Clean up both persists
          tempPersist.destroy();
          realPersist.destroy();

          // Delete the temporary IndexedDB database
          try {
            const req = indexedDB.deleteDatabase(`collab-doc-${tempId}`);
            req.onerror = () => console.warn(`Failed to delete temp db collab-doc-${tempId}`);
          } catch (e) {
            console.warn(`Error deleting database collab-doc-${tempId}:`, e);
          }

          // Remap localStorage update queue
          const oldQueueKey = `collab_queue_${tempId}`;
          const newQueueKey = `collab_queue_${realId}`;
          const oldQueueData = localStorage.getItem(oldQueueKey);
          if (oldQueueData) {
            localStorage.setItem(newQueueKey, oldQueueData);
            localStorage.removeItem(oldQueueKey);
          }

          console.log(`[OfflineSync] Remapped ${tempId} to ${realId} successfully.`);
          resolve(true);
        });
      } catch (err) {
        tempPersist.destroy();
        reject(err);
      }
    });
  });
}

/**
 * Syncs any pending title updates that were made while offline.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function syncOfflineTitles(supabase) {
  try {
    const raw = localStorage.getItem("collab_pending_titles");
    if (!raw) return;

    const pendingTitles = JSON.parse(raw);
    const keys = Object.keys(pendingTitles);
    if (keys.length === 0) return;

    console.log(`[OfflineSync] Syncing ${keys.length} offline title updates...`);
    const newPending = { ...pendingTitles };

    for (const docId of keys) {
      // Skip offline IDs (they will be synced when the document is created)
      if (docId.startsWith("offline-")) continue;

      const title = pendingTitles[docId];
      const { error } = await supabase
        .from("documents")
        .update({ title })
        .eq("id", docId);

      if (!error) {
        delete newPending[docId];
      } else {
        console.warn(`[OfflineSync] Failed to sync title for ${docId}:`, error.message);
      }
    }

    localStorage.setItem("collab_pending_titles", JSON.stringify(newPending));
  } catch (err) {
    console.error("[OfflineSync] Failed to sync offline titles:", err);
  }
}

/**
 * Syncs any pending document creations that were made while offline.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Record<string, string>>} Mapping of tempId -> realId
 */
export async function syncOfflineCreations(supabase) {
  const remappedIds = {};
  try {
    const raw = localStorage.getItem("collab_pending_creations");
    if (!raw) return remappedIds;

    const pendingCreations = JSON.parse(raw);
    if (!pendingCreations || pendingCreations.length === 0) return remappedIds;

    console.log(`[OfflineSync] Syncing ${pendingCreations.length} offline document creations...`);
    const remainingCreations = [];

    for (const item of pendingCreations) {
      const { data: realId, error } = await supabase.rpc("create_document", {
        p_title: item.title,
      });

      if (!error && realId) {
        // Remap database and queue
        await remapOfflineDocument(item.id, realId);
        remappedIds[item.id] = realId;
      } else {
        console.error(`[OfflineSync] Failed to create offline document on server:`, error);
        remainingCreations.push(item);
      }
    }

    localStorage.setItem("collab_pending_creations", JSON.stringify(remainingCreations));
  } catch (err) {
    console.error("[OfflineSync] Failed to sync offline creations:", err);
  }
  return remappedIds;
}
