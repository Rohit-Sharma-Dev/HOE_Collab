"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Client-side "New Document" button.
 * Calls the create_document RPC directly via Supabase browser client,
 * then navigates to the new editor page.
 */
export default function NewDocumentButton({ onDocumentCreated }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleCreate() {
    setLoading(true);
    const supabase = createClient();

    const isOnline = typeof navigator !== "undefined" && navigator.onLine;

    if (!isOnline) {
      // Offline creation: generate temporary ID and cache metadata locally
      const tempId = `offline-${crypto.randomUUID()}`;
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        console.error("Cannot create document offline: user not authenticated");
        setLoading(false);
        return;
      }

      const newDoc = {
        id: tempId,
        title: "Untitled Document",
        owner_id: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        role: "owner",
        collaborator_count: 1,
      };

      // Update cached list
      try {
        const cached = localStorage.getItem("collab_cached_documents");
        const cachedList = cached ? JSON.parse(cached) : [];
        cachedList.unshift(newDoc);
        localStorage.setItem("collab_cached_documents", JSON.stringify(cachedList));
      } catch (err) {
        console.warn("Failed to write to local document cache:", err);
      }

      // Add to pending creations
      try {
        const pending = localStorage.getItem("collab_pending_creations");
        const pendingList = pending ? JSON.parse(pending) : [];
        pendingList.push({ id: tempId, title: "Untitled Document" });
        localStorage.setItem("collab_pending_creations", JSON.stringify(pendingList));
      } catch (err) {
        console.warn("Failed to write to pending creations queue:", err);
      }

      if (onDocumentCreated) onDocumentCreated();
      router.push(`/editor/${tempId}`);
      return;
    }

    const { data: id, error } = await supabase.rpc("create_document", {
      p_title: "Untitled Document",
    });

    if (error || !id) {
      console.error("Failed to create document:", error);
      setLoading(false);
      return;
    }

    if (onDocumentCreated) onDocumentCreated();
    router.push(`/editor/${id}`);
  }

  return (
    <button
      id="new-doc-btn"
      type="button"
      onClick={handleCreate}
      disabled={loading}
      className="btn btn-primary disabled:opacity-60"
      aria-label="Create new document"
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <span className="spinner" style={{ width: 14, height: 14 }} />
          Creating…
        </span>
      ) : (
        <>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Document
        </>
      )}
    </button>
  );
}
