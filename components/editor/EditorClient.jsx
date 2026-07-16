"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";

import { createClient } from "@/lib/supabase/client";
import { SupabaseSyncProvider } from "@/lib/sync/SupabaseSyncProvider";
import { captureVersion, fetchVersions } from "@/lib/versions/captureVersion";
import LogoutButton from "@/components/auth/LogoutButton";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { usePresence } from "@/hooks/usePresence";
import { useDocument } from "@/hooks/useDocument";

import Toolbar from "./Toolbar";
import ConnectionStatus from "./ConnectionStatus";
import PresenceAvatars from "./PresenceAvatars";
import VersionHistorySidebar from "./VersionHistorySidebar";
import CollaboratorPanel from "./CollaboratorPanel";

/**
 * EditorClient — the full local-first editor.
 *
 * Architecture:
 *  • Y.Doc is the in-memory CRDT document.
 *  • IndexeddbPersistence syncs Y.Doc ↔ IndexedDB immediately on every change.
 *    This is the client-side source of truth — works fully offline.
 *  • SupabaseSyncProvider (loaded after IndexedDB hydrates) pushes/pulls
 *    binary Yjs updates to/from Supabase and subscribes to Realtime.
 *  • Tiptap binds directly to Y.Doc via the Collaboration extension.
 */
export default function EditorClient({ docId, user }) {
  const supabase = createClient();

  // ── Role-based access ─────────────────────────────────────────────────────
  const isViewer = user?.role === "viewer";
  const isOwner = user?.role === "owner";
  const canEdit = !isViewer;

  // ── Yjs setup ────────────────────────────────────────────────────────────
  const ydocRef = useRef(null);
  const idbRef = useRef(null);
  const syncProviderRef = useRef(null);
  const clientId = useRef(
    // Stable session ID: persisted to sessionStorage
    (() => {
      if (typeof window === "undefined") return "ssr";
      let id = sessionStorage.getItem("collab_client_id");
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem("collab_client_id", id);
      }
      return id;
    })()
  );

  // Initialise Y.Doc once (memoized in ref)
  if (!ydocRef.current) {
    ydocRef.current = new Y.Doc();
  }
  const ydoc = ydocRef.current;

  // ── State ─────────────────────────────────────────────────────────────────
  const { status, pendingCount, setStatus } = useSyncStatus();
  const { document: docMeta, updateTitle } = useDocument(docId);
  const { presentUsers, myColor } = usePresence(docId, user);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showCollabPanel, setShowCollabPanel] = useState(false);
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [idbReady, setIdbReady] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  // ── Tiptap editor ─────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable history because Yjs handles undo/redo
        history: false,
      }),
      Collaboration.configure({
        document: ydoc,
        field: "default",
      }),
      Placeholder.configure({
        placeholder: "Start writing… your work is saved locally as you type.",
      }),
      CharacterCount.configure({ limit: null }),
    ],
    editorProps: {
      attributes: {
        class: "tiptap-editor",
        "aria-label": "Document editor",
        "aria-multiline": "true",
        role: "textbox",
        spellcheck: "true",
      },
    },
    editable: canEdit,
    immediatelyRender: false,
  });

  // ── IndexedDB persistence ─────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const idb = new IndexeddbPersistence(`collab-doc-${docId}`, ydoc);
    idbRef.current = idb;

    idb.on("synced", () => {
      setIdbReady(true);
      setStatus("online", 0);
    });

    return () => idb.destroy();
  }, [docId]);

  // ── Supabase sync provider ────────────────────────────────────────────────
  // Only connect after IndexedDB has hydrated the local state.
  // This prevents Supabase updates from racing with the local state load.
  useEffect(() => {
    if (!idbReady) return;

    const provider = new SupabaseSyncProvider(
      ydoc,
      docId,
      clientId.current,
      supabase,
      setStatus
    );

    provider.connect();
    syncProviderRef.current = provider;

    return () => provider.destroy();
  }, [idbReady, docId]);

  // ── Title sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (docMeta?.title) setTitleValue(docMeta.title);
  }, [docMeta?.title]);

  const handleTitleBlur = useCallback(async () => {
    setTitleEditing(false);
    if (titleValue && titleValue !== docMeta?.title) {
      await updateTitle(titleValue);
    }
  }, [titleValue, docMeta?.title, updateTitle]);

  // ── Version history ───────────────────────────────────────────────────────
  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    const data = await fetchVersions(docId);
    setVersions(data);
    setVersionsLoading(false);
  }, [docId]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  const handleSaveVersion = useCallback(async () => {
    setIsSaving(true);
    const label = `Version ${new Date().toLocaleString()}`;
    const result = await captureVersion(ydoc, docId, label);
    if (result) {
      setVersions((prev) => [result, ...prev]);
    }
    setIsSaving(false);
  }, [ydoc, docId]);

  const handleRestore = useCallback(
    async (versionId) => {
      const res = await fetch("/api/versions/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: docId, version_id: versionId }),
      });
      if (!res.ok) {
        console.error("Restore failed:", await res.text());
      }
    },
    [docId]
  );

  // ── Char count ────────────────────────────────────────────────────────────
  const charCount = editor?.storage?.characterCount?.characters() ?? 0;
  const wordCount = editor?.storage?.characterCount?.words() ?? 0;

  return (
    <div className="flex h-screen overflow-hidden bg-chalk text-ink font-sans">
      {/* ── Column 1: Left Icon Navigation Rail ────────────────────────────── */}
      <aside className="w-11 bg-[#EDEEE8] border-r border-stone flex flex-col items-center py-4 gap-4 flex-shrink-0" aria-label="Navigation rail">
        {/* Back to Dashboard (File/Home Icon) */}
        <a
          href="/dashboard"
          className="toolbar-btn text-ink opacity-70 hover:opacity-100 flex items-center justify-center"
          title="Back to Dashboard"
          aria-label="Back to dashboard"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </a>

        {/* Search button (Decorative icon) */}
        <button
          className="toolbar-btn text-ink opacity-70 hover:opacity-100 flex items-center justify-center cursor-pointer"
          title="Search Document"
          aria-label="Search document"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>

        <div className="flex-1" />

        {/* Settings button (Decorative icon) */}
        <button
          className="toolbar-btn text-ink opacity-70 hover:opacity-100 flex items-center justify-center cursor-pointer"
          title="Settings"
          aria-label="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </aside>

      {/* ── Column 2: Center Canvas ───────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden bg-chalk">
        {/* Header toolbar */}
        <header className="border-b border-stone px-6 h-14 flex items-center justify-between flex-shrink-0 bg-chalk z-40">
          <div className="flex-1 min-w-0">
            {titleEditing ? (
              <input
                id="doc-title-input"
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                  if (e.key === "Escape") {
                    setTitleValue(docMeta?.title || "");
                    setTitleEditing(false);
                  }
                }}
                className="bg-transparent border-b border-cobalt text-ink font-sans font-medium text-[13px] outline-none w-full max-w-sm"
                autoFocus
                aria-label="Document title"
              />
            ) : (
              <button
                id="doc-title-btn"
                onClick={() => setTitleEditing(true)}
                className="text-ink font-sans font-medium text-[13px] hover:text-cobalt transition-colors truncate max-w-sm text-left cursor-pointer"
                aria-label="Click to edit document title"
              >
                {docMeta?.title || "Untitled Document"}
              </button>
            )}
          </div>

          <div className="flex items-center gap-4 flex-shrink-0">
            <PresenceAvatars presentUsers={presentUsers} myColor={myColor} />

            {/* Sync status pill */}
            {(status === "online" || status === "synced") && (
              <span className="status-pill status-synced" aria-label="Status: Synced">
                <span className="w-1.5 h-1.5 rounded-full bg-moss" />
                Synced
              </span>
            )}
            {status === "syncing" && (
              <span className="status-pill status-syncing animate-pulse" aria-label="Status: Syncing">
                <span className="w-1.5 h-1.5 rounded-full bg-cobalt" />
                Syncing…
              </span>
            )}
            {status === "offline" && (
              <span className="status-pill status-offline" aria-label="Status: Offline">
                <span className="w-1.5 h-1.5 rounded-full bg-stone" />
                Offline
              </span>
            )}

            {/* View Only badge for viewers */}
            {isViewer && (
              <span className="view-only-badge" aria-label="You have view-only access">
                <EyeIcon /> View Only
              </span>
            )}

            {/* Share button — only for owners */}
            {isOwner && (
              <button
                id="toggle-collab-btn"
                onClick={() => {
                  setShowCollabPanel(!showCollabPanel);
                }}
                className={`btn btn-ghost py-1 px-3 text-xs ${showCollabPanel ? "active" : ""}`}
                aria-label="Share document"
                aria-pressed={showCollabPanel}
              >
                <ShareIcon /> Share
              </button>
            )}

            <LogoutButton className="py-1 px-2.5" />
          </div>
        </header>

        {/* Text formatting bar */}
        {canEdit && (
          <div className="border-b border-stone px-6 py-1.5 flex items-center justify-center flex-shrink-0 bg-chalk">
            <Toolbar editor={editor} onSaveVersion={handleSaveVersion} isSaving={isSaving} />
          </div>
        )}

        {/* Editor Area */}
        <div className="flex-1 overflow-y-auto px-6 py-12 flex justify-center bg-chalk">
          <div className="w-full max-w-2xl font-serif">
            {!idbReady && (
              <div className="flex items-center justify-center h-40" aria-live="polite" aria-busy="true">
                <div className="text-center">
                  <div className="spinner mx-auto mb-3" />
                  <p className="text-ink/60 text-sm">Loading document…</p>
                </div>
              </div>
            )}
            <div style={{ display: idbReady ? "block" : "none" }}>
              <EditorContent editor={editor} id="editor-content" />
            </div>
          </div>
        </div>

        {/* Status bar */}
        <footer className="border-t border-stone px-6 py-2 flex items-center gap-4 text-xs text-ink/40 flex-shrink-0 bg-chalk font-sans">
          <span aria-label={`${wordCount} words`}>{wordCount} words</span>
          <span aria-label={`${charCount} characters`}>{charCount} characters</span>
        </footer>
      </main>

      {/* ── Column 3: Right Revision Spine (Persistent) ────────────────────── */}
      <VersionHistorySidebar
        docId={docId}
        versions={versions}
        onRestore={canEdit ? handleRestore : undefined}
        isLoading={versionsLoading}
      />

      {/* Collaborator panel drawer (if opened) */}
      {showCollabPanel && (
        <CollaboratorPanel
          docId={docId}
          currentUserId={user?.id}
          onClose={() => setShowCollabPanel(false)}
        />
      )}
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  );
}
