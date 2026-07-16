import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** POST /api/documents/new — quick-create and redirect to editor */
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const { data: id, error } = await supabase.rpc("create_document", {
    p_title: "Untitled Document",
  });

  if (error || !id) {
    return NextResponse.redirect(new URL("/dashboard?error=create_failed", request.url));
  }

  return NextResponse.redirect(new URL(`/editor/${id}`, request.url), { status: 302 });
}
