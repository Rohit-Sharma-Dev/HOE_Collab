import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const MAX_PAYLOAD_BYTES = 1048576; // 1 MB

/** POST /api/sync — validate and store a Yjs sync update */
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { document_id, update_payload, client_id } = body;

  // ── Input Validation ────────────────────────────────────────────────────────
  if (!document_id || typeof document_id !== "string") {
    return NextResponse.json({ error: "document_id is required" }, { status: 400 });
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(document_id)) {
    return NextResponse.json({ error: "document_id must be a valid UUID" }, { status: 400 });
  }

  if (!update_payload || typeof update_payload !== "string") {
    return NextResponse.json({ error: "update_payload must be a base64 string" }, { status: 400 });
  }

  // Size check before decoding (base64 is ~33% larger, so multiply by 0.75)
  if (update_payload.length * 0.75 > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "Payload too large (max 1 MB)" }, { status: 413 });
  }

  // Validate base64 format
  try {
    const decoded = Buffer.from(update_payload, "base64");
    if (decoded.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "Payload too large (max 1 MB)" }, { status: 413 });
    }
    if (decoded.length === 0) {
      return NextResponse.json({ error: "Payload must not be empty" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "update_payload is not valid base64" }, { status: 400 });
  }

  if (!client_id || typeof client_id !== "string") {
    return NextResponse.json({ error: "client_id is required" }, { status: 400 });
  }

  // ── Insert via Supabase (RLS enforces editor/owner check) ───────────────────
  const { error } = await supabase.from("sync_updates").insert({
    document_id,
    update_payload,
    client_id,
  });

  if (error) {
    if (error.code === "42501") {
      // RLS policy violation
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }
    if (error.message?.includes("payload exceeds 1 MB")) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
