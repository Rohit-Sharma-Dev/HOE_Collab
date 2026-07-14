-- =============================================================
-- Migration 001: Initial Schema
-- Local-First Collaborative Document Editor
--
-- Design decisions:
--  • documents.yjs_state stores the MERGED Yjs binary state so a
--    fresh client can hydrate without replaying every sync_update.
--  • sync_updates is an append-only incremental update log. Clients
--    push binary Yjs updates here; other clients pull and apply via
--    Y.applyUpdate(). Merge is handled by Yjs CRDT on the client —
--    the database is just a transport/storage layer.
--  • document_versions stores full snapshots (Y.encodeStateAsUpdate)
--    rather than incremental diffs because restore-from-snapshot is
--    O(1) vs. O(n) replay. The trade-off is storage space, which is
--    acceptable given snapshots are only created on user action.
--  • All PKs are UUIDs (gen_random_uuid()) for global uniqueness,
--    safe for client-generated IDs, and preventing enumeration.
-- =============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------
-- ENUM: collaborator role
-- ---------------------------------------------------------------
CREATE TYPE collaborator_role AS ENUM ('owner', 'editor', 'viewer');

-- ---------------------------------------------------------------
-- TABLE: documents
-- ---------------------------------------------------------------
-- yjs_state: the latest merged Yjs binary state (bytea).
--   Updated by a server-side trigger after sync_updates are applied,
--   or periodically. Clients use this as the starting point for sync,
--   then apply newer sync_updates on top.
-- ---------------------------------------------------------------
CREATE TABLE documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL DEFAULT 'Untitled Document',
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  yjs_state   BYTEA,                      -- latest merged Yjs state
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep updated_at fresh on every write
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------
-- TABLE: document_collaborators
-- ---------------------------------------------------------------
-- Tracks who has access to each document and at what role level.
-- The owner row is inserted atomically with the document itself
-- via the create_document() function (see 003_functions.sql).
--
-- Role semantics:
--   owner  — full control, can manage collaborators and roles
--   editor — can read and write document content + push sync updates
--   viewer — read-only; INSERT on sync_updates is blocked by RLS
-- ---------------------------------------------------------------
CREATE TABLE document_collaborators (
  document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         collaborator_role NOT NULL DEFAULT 'viewer',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (document_id, user_id)
);

-- ---------------------------------------------------------------
-- TABLE: document_versions
-- ---------------------------------------------------------------
-- Immutable snapshot log. Each row is a full Yjs state snapshot
-- (Y.encodeStateAsUpdate) taken at a point in time.
--
-- IMPORTANT — Version Restore Strategy:
--   Restoring a version does NOT overwrite the current Yjs state or
--   delete any history. Instead, the restore API decodes the target
--   snapshot, computes the delta between the current live document
--   and the target snapshot, and inserts that delta as a new
--   sync_update. This moves all collaborators' documents forward to
--   the restored content while preserving the complete history.
--   This is safe because Yjs CRDTs are monotone — you can always add
--   new operations, never need to retract old ones.
-- ---------------------------------------------------------------
CREATE TABLE document_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  snapshot     BYTEA NOT NULL,            -- full Y.encodeStateAsUpdate output
  created_by   UUID NOT NULL REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  label        TEXT                       -- optional user-provided label
);

-- ---------------------------------------------------------------
-- TABLE: sync_updates
-- ---------------------------------------------------------------
-- Append-only log of incremental Yjs binary updates.
-- Clients encode their local changes with Y.encodeStateAsUpdate or
-- Y.encodeStateAsUpdateV2 and POST the binary payload here.
-- Other clients fetch rows with created_at > their last_seen and
-- apply via Y.applyUpdate(doc, payload) — Yjs handles merging.
--
-- client_id: a stable UUID generated per browser session, used to
--   skip applying updates the client itself authored.
-- applied:   set to TRUE after the server merges this update into
--   documents.yjs_state (via background job or trigger).
-- ---------------------------------------------------------------
CREATE TABLE sync_updates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  update_payload  BYTEA NOT NULL,         -- binary Yjs update
  client_id       TEXT NOT NULL,          -- browser session ID
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied         BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------
-- SIZE GUARD: reject oversized payloads before insert
-- ---------------------------------------------------------------
-- Prevents memory exhaustion from maliciously large payloads.
-- 1 MB is generous for incremental Yjs updates (typical: <10 KB).
-- Full-document snapshots go to document_versions, not here.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_sync_update_size()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF octet_length(NEW.update_payload) > 1048576 THEN  -- 1 MB
    RAISE EXCEPTION 'sync_updates: payload exceeds 1 MB limit (got % bytes)',
      octet_length(NEW.update_payload)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_update_size_guard
  BEFORE INSERT ON sync_updates
  FOR EACH ROW EXECUTE FUNCTION check_sync_update_size();

-- ---------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------
-- Both sync_updates and document_versions are queried heavily by
-- (document_id, created_at) — clients fetch "all updates after
-- timestamp T for document D". Composite index covers both filters.
-- ---------------------------------------------------------------
CREATE INDEX idx_sync_updates_doc_time
  ON sync_updates (document_id, created_at);

CREATE INDEX idx_sync_updates_doc_applied
  ON sync_updates (document_id, applied)
  WHERE applied = FALSE;   -- partial index for unapplied updates only

CREATE INDEX idx_document_versions_doc_time
  ON document_versions (document_id, created_at);

CREATE INDEX idx_document_collaborators_user
  ON document_collaborators (user_id);   -- for "documents I have access to"
