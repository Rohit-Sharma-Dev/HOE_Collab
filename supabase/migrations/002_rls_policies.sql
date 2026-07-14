-- =============================================================
-- Migration 002: Row Level Security Policies
--
-- Design philosophy:
--  • Security is enforced at the DATABASE level, not just the API.
--    Even if application code is bypassed (e.g. direct HTTP to
--    Supabase REST API), these policies remain the last line of defense.
--  • A SECURITY DEFINER helper function (get_collaborator_role) is
--    used by all policies to avoid repeating the join logic and to
--    ensure the role check runs with elevated privileges but returns
--    only what the current user is allowed to know.
--  • Viewers are blocked from writing sync_updates at the DB level —
--    no amount of API manipulation can bypass this.
-- =============================================================

-- ---------------------------------------------------------------
-- Enable RLS on all tables
-- ---------------------------------------------------------------
ALTER TABLE documents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_collaborators   ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_updates             ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- HELPER FUNCTION: get_collaborator_role
-- ---------------------------------------------------------------
-- Returns the current user's role for a given document, or NULL
-- if the user has no access. SECURITY DEFINER so it can bypass RLS
-- on document_collaborators when doing the lookup (avoids infinite
-- recursion in policies that reference document_collaborators).
--
-- Usage in policies: get_collaborator_role(document_id) IS NOT NULL
--                    get_collaborator_role(document_id) IN ('owner','editor')
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_collaborator_role(doc_id UUID)
RETURNS collaborator_role
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role
  FROM document_collaborators
  WHERE document_id = doc_id
    AND user_id = auth.uid()
  LIMIT 1;
$$;

-- ---------------------------------------------------------------
-- TABLE: documents
-- ---------------------------------------------------------------

-- SELECT: only collaborators (any role) can read
CREATE POLICY "documents_select_collaborators"
  ON documents FOR SELECT
  TO authenticated
  USING (get_collaborator_role(id) IS NOT NULL);

-- INSERT: any authenticated user can create a new document.
--   The create_document() function immediately inserts the owner row
--   in document_collaborators so subsequent selects work.
CREATE POLICY "documents_insert_authenticated"
  ON documents FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- UPDATE: only owner or editor can update document content
CREATE POLICY "documents_update_editor_owner"
  ON documents FOR UPDATE
  TO authenticated
  USING (get_collaborator_role(id) IN ('owner', 'editor'))
  WITH CHECK (get_collaborator_role(id) IN ('owner', 'editor'));

-- DELETE: only the owner can delete the document
CREATE POLICY "documents_delete_owner"
  ON documents FOR DELETE
  TO authenticated
  USING (get_collaborator_role(id) = 'owner');

-- ---------------------------------------------------------------
-- TABLE: document_collaborators
-- ---------------------------------------------------------------

-- SELECT: any collaborator can see who else has access
CREATE POLICY "collaborators_select"
  ON document_collaborators FOR SELECT
  TO authenticated
  USING (get_collaborator_role(document_id) IS NOT NULL);

-- INSERT: only the document owner can add collaborators
CREATE POLICY "collaborators_insert_owner"
  ON document_collaborators FOR INSERT
  TO authenticated
  WITH CHECK (get_collaborator_role(document_id) = 'owner');

-- UPDATE: only the owner can change roles
CREATE POLICY "collaborators_update_owner"
  ON document_collaborators FOR UPDATE
  TO authenticated
  USING (get_collaborator_role(document_id) = 'owner')
  WITH CHECK (get_collaborator_role(document_id) = 'owner');

-- DELETE: only the owner can remove collaborators
--   (or a user can remove themselves)
CREATE POLICY "collaborators_delete_owner_or_self"
  ON document_collaborators FOR DELETE
  TO authenticated
  USING (
    get_collaborator_role(document_id) = 'owner'
    OR user_id = auth.uid()
  );

-- ---------------------------------------------------------------
-- TABLE: document_versions
-- ---------------------------------------------------------------

-- SELECT: any collaborator can browse version history
CREATE POLICY "versions_select_collaborators"
  ON document_versions FOR SELECT
  TO authenticated
  USING (get_collaborator_role(document_id) IS NOT NULL);

-- INSERT: only editor or owner can create versions
--   Viewers cannot save versions even by crafting a direct request.
CREATE POLICY "versions_insert_editor_owner"
  ON document_versions FOR INSERT
  TO authenticated
  WITH CHECK (
    get_collaborator_role(document_id) IN ('owner', 'editor')
    AND created_by = auth.uid()
  );

-- No UPDATE or DELETE on versions — they are immutable audit records.
-- (No policies needed; RLS blocks by default when no policy matches.)

-- ---------------------------------------------------------------
-- TABLE: sync_updates
-- ---------------------------------------------------------------
-- This is the most security-sensitive table. Malicious writes here
-- could corrupt collaborators' documents via Yjs update application.
-- ---------------------------------------------------------------

-- SELECT: any collaborator can read sync updates (to apply them)
CREATE POLICY "sync_select_collaborators"
  ON sync_updates FOR SELECT
  TO authenticated
  USING (get_collaborator_role(document_id) IS NOT NULL);

-- INSERT: ONLY editor or owner can push sync updates.
--   Viewers are explicitly BLOCKED at the database level.
--   This is the critical security boundary — the UI also hides the
--   editor, but this policy is the authoritative enforcement.
CREATE POLICY "sync_insert_editor_owner"
  ON sync_updates FOR INSERT
  TO authenticated
  WITH CHECK (
    get_collaborator_role(document_id) IN ('owner', 'editor')
  );

-- UPDATE: only the server-side service role updates `applied` flag.
--   Regular users cannot mark updates as applied.
--   (No UPDATE policy = blocked for all non-service-role users.)

-- DELETE: blocked for all users — sync_updates is append-only.
--   Historical updates are needed for clients that come online
--   after extended offline periods.
