"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * CollaboratorPanel — slide-out panel for managing document collaborators.
 *
 * Only visible to document owners. Supports:
 *  • Viewing current collaborators and their roles
 *  • Inviting new collaborators by email (editor or viewer)
 *  • Removing collaborators
 *
 * Calls the /api/collaborators REST endpoints.
 */
export default function CollaboratorPanel({ docId, currentUserId, onClose }) {
  const [collaborators, setCollaborators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ── Fetch collaborators ──────────────────────────────────────────────────
  const fetchCollaborators = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/collaborators?docId=${docId}`);
      const data = await res.json();
      if (res.ok) {
        setCollaborators(data.collaborators || []);
      } else {
        setError(data.error || "Failed to load collaborators");
      }
    } catch (err) {
      setError("Network error loading collaborators");
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    fetchCollaborators();
  }, [fetchCollaborators]);

  // ── Invite ───────────────────────────────────────────────────────────────
  const handleInvite = useCallback(
    async (e) => {
      e.preventDefault();
      if (!email.trim()) return;

      setInviting(true);
      setError("");
      setSuccess("");

      try {
        const res = await fetch("/api/collaborators", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document_id: docId, email: email.trim(), role }),
        });
        const data = await res.json();

        if (res.ok) {
          setSuccess(`Invited ${email.trim()} as ${role}`);
          setEmail("");
          fetchCollaborators();
        } else {
          setError(data.error || "Failed to invite");
        }
      } catch (err) {
        setError("Network error");
      } finally {
        setInviting(false);
      }
    },
    [docId, email, role, fetchCollaborators]
  );

  // ── Remove ───────────────────────────────────────────────────────────────
  const handleRemove = useCallback(
    async (userId) => {
      setError("");
      setSuccess("");

      try {
        const res = await fetch("/api/collaborators", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document_id: docId, user_id: userId }),
        });
        const data = await res.json();

        if (res.ok) {
          setSuccess("Collaborator removed");
          fetchCollaborators();
        } else {
          setError(data.error || "Failed to remove");
        }
      } catch (err) {
        setError("Network error");
      }
    },
    [docId, fetchCollaborators]
  );

  // ── Role colors ──────────────────────────────────────────────────────────
  const roleStyle = {
    owner: "collab-role-owner",
    editor: "collab-role-editor",
    viewer: "collab-role-viewer",
  };

  return (
    <aside
      className="collab-panel animate-fade-in"
      role="complementary"
      aria-label="Collaborator management"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
          <UsersIcon />
          Share Document
        </h2>
        <button
          id="collab-panel-close"
          onClick={onClose}
          className="toolbar-btn"
          aria-label="Close collaborator panel"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Invite form */}
      <form onSubmit={handleInvite} className="px-4 py-3 border-b border-stone">
        <label htmlFor="collab-email" className="block text-xs text-ink/60 mb-1.5 font-medium">
          Invite by email
        </label>
        <div className="flex gap-2">
          <input
            id="collab-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            className="input-base text-xs py-1.5 flex-1"
            disabled={inviting}
            required
            aria-label="Collaborator email address"
          />
        </div>

        <div className="flex items-center gap-2 mt-2">
          <select
            id="collab-role-select"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="input-base text-xs py-1.5 w-auto"
            disabled={inviting}
            aria-label="Collaborator role"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            id="collab-invite-btn"
            type="submit"
            disabled={inviting || !email.trim()}
            className="btn btn-primary py-1.5 px-3 text-xs flex-1 justify-center disabled:opacity-50"
            aria-label="Send invitation"
          >
            {inviting ? (
              <span className="flex items-center gap-1.5">
                <span className="spinner" style={{ width: 12, height: 12 }} />
                Inviting…
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <SendIcon />
                Invite
              </span>
            )}
          </button>
        </div>
      </form>

      {/* Messages */}
      {error && (
        <div className="mx-4 mt-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-red-700 text-xs animate-fade-in" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="mx-4 mt-2 p-2 rounded bg-emerald-500/15 border border-emerald-500/20 text-emerald-800 text-xs animate-fade-in" role="status">
          {success}
        </div>
      )}

      {/* Collaborator list */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-4 py-1">
          <p className="text-xs text-ink/50 font-medium uppercase tracking-wider">
            {collaborators.length} Collaborator{collaborators.length !== 1 ? "s" : ""}
          </p>
        </div>

        {loading && (
          <div className="px-4 py-6 text-center">
            <div className="spinner mx-auto mb-2" />
            <p className="text-ink/40 text-xs">Loading…</p>
          </div>
        )}

        {!loading &&
          collaborators.map((c, i) => {
            const isOwner = c.role === "owner";
            const isSelf = c.user_id === currentUserId;

            return (
              <div
                key={c.user_id}
                className="collab-user-row mx-2 animate-fade-in-up"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {/* Avatar */}
                <div
                  className="collab-avatar"
                  style={{
                    background: `hsl(${parseInt(c.user_id.slice(-2), 16) * 1.4}, 60%, 55%)`,
                  }}
                  aria-hidden="true"
                >
                  {(c.user_id || "?").slice(0, 2).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">
                    {c.user_id.slice(0, 8)}…
                    {isSelf && <span className="text-ink/40 text-xs ml-1">(you)</span>}
                  </p>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleStyle[c.role] || roleStyle.viewer}`}>
                    {c.role}
                  </span>
                </div>

                {/* Remove (not for owner, not for self) */}
                {!isOwner && !isSelf && (
                  <button
                    id={`remove-collab-${c.user_id.slice(0, 8)}`}
                    onClick={() => handleRemove(c.user_id)}
                    className="btn btn-danger py-0.5 px-2 text-xs"
                    aria-label={`Remove collaborator ${c.user_id.slice(0, 8)}`}
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </aside>
  );
}

// ── SVG Icons ────────────────────────────────────────────────────────────────

function UsersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
