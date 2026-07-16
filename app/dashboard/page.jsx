"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import LogoutButton from "@/components/auth/LogoutButton";
import NewDocumentButton from "@/components/dashboard/NewDocumentButton";
import { createClient } from "@/lib/supabase/client";
import { syncOfflineCreations, syncOfflineTitles } from "@/lib/sync/offlineSync";

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 1. Authenticate user client-side
  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
      } else {
        setUser(user);
      }
    }
    checkAuth();
  }, [router, supabase]);

  // 2. Fetch documents list (with offline fallback and online sync)
  const loadDocuments = async () => {
    if (!user) return;

    // Show cache first to make interface load instantly
    const cached = localStorage.getItem("collab_cached_documents");
    if (cached) {
      setDocuments(JSON.parse(cached));
    }

    const isOnline = typeof navigator !== "undefined" && navigator.onLine;

    if (isOnline) {
      try {
        // Sync offline metadata changes before refetching
        await syncOfflineCreations(supabase);
        await syncOfflineTitles(supabase);
      } catch (err) {
        console.warn("[Dashboard] Offline sync pre-run failed:", err);
      }

      const { data, error: fetchErr } = await supabase.rpc("get_documents_for_user");

      if (fetchErr) {
        console.warn("[Dashboard] Failed to fetch documents from DB:", fetchErr.message);
        if (!cached) {
          setError(fetchErr.message);
        }
      } else {
        setDocuments(data || []);
        localStorage.setItem("collab_cached_documents", JSON.stringify(data || []));
        setError(null);
      }
    } else {
      // Offline fallback
      if (cached) {
        setDocuments(JSON.parse(cached));
        setError(null);
      } else {
        setDocuments([]);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    if (user) {
      loadDocuments();
    }
  }, [user]);

  // Listen for going online to automatically refresh/sync
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      loadDocuments();
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [user]);

  if (loading && !documents.length) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-chalk text-ink">
        <div className="text-center">
          <div className="spinner mx-auto mb-4" />
          <p className="text-sm text-ink/60">Loading your documents…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-chalk text-ink">
      {/* Navbar */}
      <header className="bg-[#EDEEE8] border-b border-stone sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded overflow-hidden flex items-center justify-center">
              <img src="/favicon_io/apple-touch-icon.png" alt="Colab Logo" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-ink">Colab</span>
          </Link>

          <div className="flex items-center gap-3">
            <span className="text-ink/60 text-sm hidden sm:block">{user?.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-10">
        {/* Header row */}
        <div className="flex items-center justify-between mb-8 animate-fade-in-up">
          <div>
            <h1 className="text-3xl font-bold text-ink mb-1 font-serif">My Documents</h1>
            <p className="text-ink/60 text-sm">
              {documents?.length || 0} document{documents?.length !== 1 ? "s" : ""}
            </p>
          </div>
          <NewDocumentButton onDocumentCreated={loadDocuments} />
        </div>

        {/* Error state */}
        {error && !documents.length && (
          <div className="p-4 rounded bg-red-500/10 border border-red-500/20 text-red-700 mb-6" role="alert">
            Failed to load documents: {error}
          </div>
        )}

        {/* Empty state */}
        {!documents?.length && (
          <div className="text-center py-24 animate-fade-in">
            <div className="w-16 h-16 rounded bg-[#EDEEE8] border border-stone flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-cobalt)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-ink mb-2">No documents yet</h2>
            <p className="text-ink/60 text-sm mb-6 font-serif">Create your first document to get started</p>
            <NewDocumentButton onDocumentCreated={loadDocuments} />
          </div>
        )}

        {/* Document grid */}
        {documents?.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {documents.map((doc, i) => (
              <DocumentCard key={doc.id} doc={doc} index={i} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function DocumentCard({ doc, index }) {
  const roleColors = {
    owner: "collab-role-owner",
    editor: "collab-role-editor",
    viewer: "collab-role-viewer",
  };

  const isOfflineTemp = doc.id.startsWith("offline-");

  return (
    <Link
      href={`/editor/${doc.id}`}
      id={`doc-card-${doc.id}`}
      className="card p-5 block group animate-fade-in-up"
      style={{ animationDelay: `${index * 50}ms` }}
      aria-label={`Open document: ${doc.title}`}
    >
      {/* Doc icon */}
      <div className="w-10 h-10 rounded bg-chalk border border-stone flex items-center justify-center mb-4 transition-all">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-cobalt)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </div>

      <h3 className="font-semibold text-ink text-sm mb-1 truncate group-hover:text-cobalt transition-colors font-serif">
        {doc.title} {isOfflineTemp && <span className="text-[10px] text-stone font-sans italic ml-1">(Offline pending)</span>}
      </h3>

      <p className="text-ink/50 text-xs mb-3">
        {new Date(doc.updated_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </p>

      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${roleColors[doc.role] || roleColors.viewer}`}>
          {doc.role}
        </span>
        <span className="text-ink/40 text-xs">
          {isOfflineTemp ? "Local only" : `${doc.collaborator_count} collaborator${doc.collaborator_count !== 1 ? "s" : ""}`}
        </span>
      </div>
    </Link>
  );
}
