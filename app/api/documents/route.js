import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/documents — list all documents for the current user */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("get_documents_for_user");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ documents: data });
}

/** POST /api/documents — create a new document */
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let title = "Untitled Document";
  try {
    const body = await request.json();
    if (body.title && typeof body.title === "string") {
      title = body.title.slice(0, 255); // max length guard
    }
  } catch {}

  const { data, error } = await supabase.rpc("create_document", { p_title: title });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data }, { status: 201 });
}
