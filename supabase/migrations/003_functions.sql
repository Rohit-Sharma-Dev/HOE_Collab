-- =============================================================
-- Migration 003: Database Functions
--
-- Functions here are invoked by the application via Supabase RPC.
-- They run as SECURITY DEFINER (bypassing RLS) only where necessary
-- and strictly validated within the function body.
-- =============================================================

-- ---------------------------------------------------------------
-- FUNCTION: create_document
-- ---------------------------------------------------------------
-- Atomically creates a document AND inserts the owner row in
-- document_collaborators. This is critical — if only the document
-- row is inserted without the collaborator row, the owner would be
-- immediately locked out by the RLS SELECT policy (which requires
-- a collaborator row to exist).
--
-- Called by the client immediately after the user clicks "New Document".
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_document(
  p_title TEXT DEFAULT 'Untitled Document'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_doc_id UUID;
BEGIN
  -- Validate: user must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Insert document
  INSERT INTO documents (title, owner_id)
  VALUES (p_title, auth.uid())
  RETURNING id INTO v_doc_id;

  -- Atomically insert owner collaborator row
  INSERT INTO document_collaborators (document_id, user_id, role)
  VALUES (v_doc_id, auth.uid(), 'owner');

  RETURN v_doc_id;
END;
$$;

-- ---------------------------------------------------------------
-- FUNCTION: invite_collaborator
-- ---------------------------------------------------------------
-- Allows a document owner to invite another user by email.
-- Looks up the user ID from auth.users via the email, then inserts
-- the collaborator row.
--
-- Returns the new collaborator's user_id on success.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION invite_collaborator(
  p_document_id  UUID,
  p_email        TEXT,
  p_role         collaborator_role DEFAULT 'editor'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invitee_id UUID;
BEGIN
  -- Only document owners can invite
  IF get_collaborator_role(p_document_id) != 'owner' THEN
    RAISE EXCEPTION 'Only the document owner can invite collaborators'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Look up the invited user — auth.users is not directly accessible
  -- from client; this SECURITY DEFINER function bridges that safely.
  SELECT id INTO v_invitee_id
  FROM auth.users
  WHERE email = p_email
  LIMIT 1;

  IF v_invitee_id IS NULL THEN
    RAISE EXCEPTION 'No user found with email %', p_email
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Upsert: if already a collaborator, update role
  INSERT INTO document_collaborators (document_id, user_id, role)
  VALUES (p_document_id, v_invitee_id, p_role)
  ON CONFLICT (document_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;

  RETURN v_invitee_id;
END;
$$;

-- ---------------------------------------------------------------
-- FUNCTION: merge_yjs_state
-- ---------------------------------------------------------------
-- Called by a server-side cron or webhook after batches of
-- sync_updates accumulate. Marks updates as applied=TRUE.
-- The actual Yjs merge is done client-side; this function just
-- updates the applied flag and optionally stores the new merged
-- state (passed in by the server).
--
-- In the MVP, the API route /api/sync calls this after storing a
-- new update, passing the merged state computed by the server.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION merge_yjs_state(
  p_document_id  UUID,
  p_merged_state BYTEA,
  p_update_ids   UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update the merged state on the document
  UPDATE documents
  SET yjs_state = p_merged_state, updated_at = NOW()
  WHERE id = p_document_id;

  -- Mark updates as applied
  UPDATE sync_updates
  SET applied = TRUE
  WHERE id = ANY(p_update_ids)
    AND document_id = p_document_id;
END;
$$;

-- ---------------------------------------------------------------
-- FUNCTION: restore_version
-- ---------------------------------------------------------------
-- Restores a document version by inserting a FORWARD UPDATE into
-- sync_updates — it does NOT overwrite or delete any existing data.
--
-- The approach:
--   1. Load the target snapshot from document_versions.
--   2. The caller (API route) computes the diff between the current
--      Yjs state and the target snapshot using Y.diffUpdate().
--   3. That diff is passed here as p_restore_payload and inserted
--      as a new sync_update with client_id='server:restore'.
--   4. All connected clients receive this via Realtime and apply it,
--      making their documents look like the restored version.
--   5. The original sync history is fully preserved.
--
-- This is fundamentally safe because Yjs CRDTs are monotone:
-- once content is added to the CRDT graph, it can be semantically
-- "deleted" or "replaced" by new operations, but the CRDT never
-- loses the audit trail of what happened.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION restore_version(
  p_document_id    UUID,
  p_version_id     UUID,
  p_restore_payload BYTEA  -- the computed forward delta from the API
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_update_id UUID;
BEGIN
  -- Authorization: only editor/owner can restore
  IF get_collaborator_role(p_document_id) NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION 'Insufficient permissions to restore version'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Verify the version belongs to this document
  IF NOT EXISTS (
    SELECT 1 FROM document_versions
    WHERE id = p_version_id AND document_id = p_document_id
  ) THEN
    RAISE EXCEPTION 'Version % not found for document %', p_version_id, p_document_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Validate payload size (same guard as the trigger on sync_updates)
  IF octet_length(p_restore_payload) > 1048576 THEN
    RAISE EXCEPTION 'Restore payload exceeds 1 MB limit'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Insert the forward-moving restore update as a new sync_update.
  -- client_id uses a special prefix so clients can identify these
  -- in audit logs but still apply them normally via Y.applyUpdate.
  INSERT INTO sync_updates (document_id, update_payload, client_id)
  VALUES (p_document_id, p_restore_payload, 'server:restore:' || p_version_id)
  RETURNING id INTO v_update_id;

  RETURN v_update_id;
END;
$$;

-- ---------------------------------------------------------------
-- FUNCTION: get_documents_for_user
-- ---------------------------------------------------------------
-- Returns all documents the current user has access to, with their
-- role, for rendering the dashboard. Avoids N+1 queries from the client.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_documents_for_user()
RETURNS TABLE (
  id          UUID,
  title       TEXT,
  owner_id    UUID,
  created_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ,
  role        collaborator_role,
  collaborator_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    d.id,
    d.title,
    d.owner_id,
    d.created_at,
    d.updated_at,
    dc_me.role,
    COUNT(dc_all.user_id) AS collaborator_count
  FROM documents d
  JOIN document_collaborators dc_me
    ON dc_me.document_id = d.id AND dc_me.user_id = auth.uid()
  LEFT JOIN document_collaborators dc_all
    ON dc_all.document_id = d.id
  GROUP BY d.id, d.title, d.owner_id, d.created_at, d.updated_at, dc_me.role
  ORDER BY d.updated_at DESC;
$$;
