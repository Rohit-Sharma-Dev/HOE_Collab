"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * useDocument — loads document metadata and handles title updates.
 * Supports offline metadata fallback and queues title updates when offline.
 *
 * @param {string} docId
 * @returns {{ document, loading, error, updateTitle }}
 */
export function useDocument(docId) {
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const supabase = createClient();

  const getDocFromCache = useCallback((id) => {
    try {
      const cached = localStorage.getItem("collab_cached_documents");
      if (cached) {
        const cachedList = JSON.parse(cached);
        return cachedList.find((d) => d.id === id) || null;
      }
    } catch (err) {
      console.warn("[useDocument] Failed to read from cache:", err);
    }
    return null;
  }, []);

  const updateDocInCache = useCallback((data) => {
    try {
      const cached = localStorage.getItem("collab_cached_documents");
      const cachedList = cached ? JSON.parse(cached) : [];
      const index = cachedList.findIndex((d) => d.id === data.id);
      if (index !== -1) {
        cachedList[index] = { ...cachedList[index], ...data };
      } else {
        cachedList.push(data);
      }
      localStorage.setItem("collab_cached_documents", JSON.stringify(cachedList));
    } catch (err) {
      console.warn("[useDocument] Failed to write update to cache:", err);
    }
  }, []);

  useEffect(() => {
    if (!docId) return;

    async function load() {
      setLoading(true);
      const isOnline = typeof navigator !== "undefined" && navigator.onLine;
      const isOfflineTemp = docId.startsWith("offline-");

      if (isOnline && !isOfflineTemp) {
        const { data, error: fetchErr } = await supabase
          .from("documents")
          .select("id, title, owner_id, created_at, updated_at")
          .eq("id", docId)
          .single();

        if (fetchErr) {
          console.warn("[useDocument] Fetch failed online, checking local cache:", fetchErr.message);
          const cachedDoc = getDocFromCache(docId);
          if (cachedDoc) {
            setDocument(cachedDoc);
            setError(null);
          } else {
            setError(fetchErr.message);
          }
        } else {
          setDocument(data);
          updateDocInCache(data);
          setError(null);
        }
      } else {
        // Offline or temporary ID: load fallback metadata from local cache
        const cachedDoc = getDocFromCache(docId);
        if (cachedDoc) {
          setDocument(cachedDoc);
          setError(null);
        } else if (isOfflineTemp) {
          // Document was created offline, default basic metadata
          setDocument({
            id: docId,
            title: "Untitled Document",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          setError(null);
        } else {
          setError("Document metadata not cached locally (offline)");
        }
      }
      setLoading(false);
    }

    load();
  }, [docId, getDocFromCache, updateDocInCache]);

  const updateTitle = useCallback(
    async (newTitle) => {
      if (!docId) return;

      // 1. Optimistically update local UI state immediately
      setDocument((d) => (d ? { ...d, title: newTitle } : { id: docId, title: newTitle }));

      // 2. Cache updated title locally so dashboard displays the change
      updateDocInCache({
        id: docId,
        title: newTitle,
        updated_at: new Date().toISOString(),
      });

      const isOnline = typeof navigator !== "undefined" && navigator.onLine;
      const isOfflineTemp = docId.startsWith("offline-");

      if (!isOnline || isOfflineTemp) {
        // Offline or temporary document ID: queue title update to sync later
        try {
          const pending = localStorage.getItem("collab_pending_titles");
          const pendingTitles = pending ? JSON.parse(pending) : {};
          pendingTitles[docId] = newTitle;
          localStorage.setItem("collab_pending_titles", JSON.stringify(pendingTitles));
          console.log(`[useDocument] Queued offline title update for ${docId} to: "${newTitle}"`);
        } catch (err) {
          console.warn("[useDocument] Failed to save pending title to queue:", err);
        }
      } else {
        // Online: perform direct update to database
        const { error: updateErr } = await supabase
          .from("documents")
          .update({ title: newTitle })
          .eq("id", docId);

        if (updateErr) {
          console.warn("[useDocument] Failed to update title online, queuing update instead:", updateErr.message);
          // Fallback queue on network error
          try {
            const pending = localStorage.getItem("collab_pending_titles");
            const pendingTitles = pending ? JSON.parse(pending) : {};
            pendingTitles[docId] = newTitle;
            localStorage.setItem("collab_pending_titles", JSON.stringify(pendingTitles));
          } catch (err) {
            console.warn("[useDocument] Failed to queue title update fallback:", err);
          }
        }
      }
    },
    [docId, updateDocInCache]
  );

  return { document, loading, error, updateTitle };
}
