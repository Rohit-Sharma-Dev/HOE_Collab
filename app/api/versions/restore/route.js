import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import * as Y from "yjs";

/**
 * POST /api/versions/restore
 *
 * Restores a document to a previous version WITHOUT destroying history.
 *
 * Strategy (forward-update, non-destructive):
 *  1. Load the target version snapshot (full Yjs state).
 *  2. Load the current merged Yjs state from `documents.yjs_state`.
 *  3. Create a new Y.Doc and apply the current state.
 *  4. Create a second Y.Doc and apply the target snapshot.
 *  5. Compute the diff: what update would move doc from current → target?
 *     We use Y.encodeStateAsUpdate with the current state vector as the
 *     "already known" state — this gives us only what's new in the target.
 *  6. Insert this diff as a new sync_update via restore_version() RPC.
 *  7. All online clients receive it via Realtime and apply it.
 *
 * History is never mutated — the restore is just another forward update.
 */
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { document_id, version_id } = body;
  if (!document_id || !version_id) {
    return NextResponse.json({ error: "document_id and version_id required" }, { status: 400 });
  }

  // 1. Load target snapshot
  const { data: versionRow, error: vErr } = await supabase
    .from("document_versions")
    .select("snapshot")
    .eq("id", version_id)
    .eq("document_id", document_id)
    .single();

  if (vErr || !versionRow) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  // 2. Load current merged state
  const { data: docRow } = await supabase
    .from("documents")
    .select("yjs_state")
    .eq("id", document_id)
    .single();

  // Helper: decode base64 or hex to Uint8Array
  function decodeState(b64) {
    if (!b64) return null;
    if (typeof b64 === "string" && b64.startsWith("\\x")) {
      const hex = b64.slice(2);
      const arr = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2)
        arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
      return arr;
    }
    return new Uint8Array(Buffer.from(b64, "base64"));
  }

  const targetBytes = decodeState(versionRow.snapshot);
  const currentBytes = docRow?.yjs_state ? decodeState(docRow.yjs_state) : null;

  // 3. Build current Y.Doc
  const currentDoc = new Y.Doc();
  if (currentBytes) Y.applyUpdate(currentDoc, currentBytes);

  // 4. Build target Y.Doc
  const targetDoc = new Y.Doc();
  Y.applyUpdate(targetDoc, targetBytes);

  // 5. Compute forward delta: encode target state but only the parts
  //    that differ from current. This is the "restore update".
  const currentSV = Y.encodeStateVector(currentDoc);
  const restoreDiff = Y.encodeStateAsUpdate(targetDoc, currentSV);

  if (restoreDiff.length === 0) {
    return NextResponse.json({ message: "Document is already at this version" });
  }

  const restorePayload = Buffer.from(restoreDiff).toString("base64");

  // 6. Insert via RPC (checks permissions, validates size)
  const { data: updateId, error: rpcErr } = await supabase.rpc("restore_version", {
    p_document_id: document_id,
    p_version_id: version_id,
    p_restore_payload: restorePayload,
  });

  if (rpcErr) {
    if (rpcErr.code === "42501" || rpcErr.message?.includes("Insufficient")) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, update_id: updateId });
}
