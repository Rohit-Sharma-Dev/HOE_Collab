import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/collaborators?docId=... */
export async function GET(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const docId = searchParams.get("docId");
  if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });

  const { data, error } = await supabase
    .from("document_collaborators")
    .select("user_id, role, created_at")
    .eq("document_id", docId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ collaborators: data });
}

/** POST /api/collaborators — invite by email */
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { document_id, email, role = "editor" } = body;
  if (!document_id || !email) {
    return NextResponse.json({ error: "document_id and email required" }, { status: 400 });
  }

  if (!["editor", "viewer"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("invite_collaborator", {
    p_document_id: document_id,
    p_email: email,
    p_role: role,
  });

  if (error) {
    if (error.message?.includes("insufficient_privilege")) {
      return NextResponse.json({ error: "Only owners can invite collaborators" }, { status: 403 });
    }
    if (error.message?.includes("No user found")) {
      return NextResponse.json({ error: `No account found for ${email}` }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user_id: data });
}

/** DELETE /api/collaborators — remove a collaborator */
export async function DELETE(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { document_id, user_id } = body;
  if (!document_id || !user_id) {
    return NextResponse.json({ error: "document_id and user_id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("document_collaborators")
    .delete()
    .eq("document_id", document_id)
    .eq("user_id", user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
