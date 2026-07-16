import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/versions?docId=... — list versions for a document */
export async function GET(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const docId = searchParams.get("docId");
  if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });

  const { data, error } = await supabase
    .from("document_versions")
    .select("id, label, created_at, created_by")
    .eq("document_id", docId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ versions: data });
}

/** POST /api/versions — save a new version snapshot */
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { document_id, snapshot, label } = body;
  if (!document_id || !snapshot) {
    return NextResponse.json({ error: "document_id and snapshot required" }, { status: 400 });
  }

  // Size guard for snapshots (allow up to 10 MB — full doc state)
  if (snapshot.length * 0.75 > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Snapshot too large" }, { status: 413 });
  }

  const { data, error } = await supabase
    .from("document_versions")
    .insert({
      document_id,
      snapshot,
      label: label || `Version ${new Date().toLocaleString()}`,
      created_by: user.id,
    })
    .select("id, label, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ version: data }, { status: 201 });
}
