"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import EditorClient from "@/components/editor/EditorClient";
import { remapOfflineDocument } from "@/lib/sync/offlineSync";

export default function EditorPage({ params }) {
  const router = useRouter();
  const supabase = createClient();
  const { docId: initialDocId } = use(params);

  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [docId, setDocId] = useState(initialDocId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Authenticate user and resolve collaborator role (with offline fallbacks)
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        router.push("/login");
        return;
      }
      setUser(authUser);

      const isOnline = typeof navigator !== "undefined" && navigator.onLine;
      const isOfflineTempId = docId.startsWith("offline-");

      // 1. If online and editing a temporary offline document, sync/create it on the server
      if (isOnline && isOfflineTempId) {
        console.log(`[Editor] Online connection detected for temp document ${docId}. Syncing creation...`);
        let title = "Untitled Document";
        try {
          const cached = localStorage.getItem("collab_cached_documents");
          if (cached) {
            const cachedList = JSON.parse(cached);
            const found = cachedList.find((d) => d.id === docId);
            if (found) title = found.title;
          }
        } catch (err) {
          console.warn("Failed to retrieve cached title:", err);
        }

        const { data: realId, error: createErr } = await supabase.rpc("create_document", {
          p_title: title,
        });

        if (createErr || !realId) {
          console.error("Failed to register document on server:", createErr);
          setError("Failed to create document on the server: " + (createErr?.message || "Unknown error"));
          setLoading(false);
          return;
        }

        // Remap IndexedDB and localStorage queue to the server-assigned UUID
        try {
          await remapOfflineDocument(docId, realId);
        } catch (remapErr) {
          console.error("Failed to migrate offline local data to real ID:", remapErr);
        }

        // Update cached lists in local storage
        try {
          const cached = localStorage.getItem("collab_cached_documents");
          if (cached) {
            let cachedList = JSON.parse(cached);
            cachedList = cachedList.map((d) => {
              if (d.id === docId) {
                return { ...d, id: realId };
              }
              return d;
            });
            localStorage.setItem("collab_cached_documents", JSON.stringify(cachedList));
          }

          const pending = localStorage.getItem("collab_pending_creations");
          if (pending) {
            const pendingList = JSON.parse(pending);
            const remaining = pendingList.filter((item) => item.id !== docId);
            localStorage.setItem("collab_pending_creations", JSON.stringify(remaining));
          }
        } catch (err) {
          console.warn("Failed to update cache on registration:", err);
        }

        // Transition URL to real ID without refreshing
        setDocId(realId);
        window.history.replaceState(null, "", `/editor/${realId}`);
        setRole("owner");
        setLoading(false);
        return;
      }

      // 2. Fetch/Determine collaborator role
      if (isOnline && !isOfflineTempId) {
        const { data: collaborator, error: collabErr } = await supabase
          .from("document_collaborators")
          .select("role")
          .eq("document_id", docId)
          .eq("user_id", authUser.id)
          .single();

        if (collabErr || !collaborator) {
          console.warn("[Editor] Failed to fetch collaborator role online, checking cache:", collabErr?.message);
          const cachedRole = getRoleFromCache(docId);
          if (cachedRole) {
            setRole(cachedRole);
          } else {
            router.push("/dashboard?error=no_access");
            return;
          }
        } else {
          setRole(collaborator.role);
        }
      } else {
        // Offline/Temp ID fallback
        const cachedRole = getRoleFromCache(docId);
        if (cachedRole) {
          setRole(cachedRole);
        } else if (isOfflineTempId) {
          setRole("owner");
        } else {
          console.warn(`[Editor] Access validation failed: no collaborator role found in cache for ${docId}`);
          router.push("/dashboard?error=no_access");
          return;
        }
      }
      setLoading(false);
    }

    loadData();
  }, [docId, router, supabase]);

  const getRoleFromCache = (id) => {
    try {
      const cached = localStorage.getItem("collab_cached_documents");
      if (cached) {
        const cachedList = JSON.parse(cached);
        const doc = cachedList.find((d) => d.id === id);
        return doc ? doc.role : null;
      }
    } catch (err) {
      console.warn("Failed to read collaborator role from cache:", err);
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-chalk animate-fade-in" aria-live="polite" aria-busy="true">
        <div className="text-center">
          <div className="spinner mx-auto mb-3" />
          <p className="text-ink/60 text-sm">Verifying access…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-chalk" role="alert">
        <div className="text-center max-w-md p-6 bg-red-500/10 border border-red-500/20 rounded">
          <h2 className="text-lg font-bold text-red-700 mb-2">Sync Error</h2>
          <p className="text-ink/70 text-sm mb-4">{error}</p>
          <button onClick={() => router.push("/dashboard")} className="btn btn-primary text-xs">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <EditorClient
      docId={docId}
      user={{
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.email?.split("@")[0],
        role: role,
      }}
    />
  );
}
