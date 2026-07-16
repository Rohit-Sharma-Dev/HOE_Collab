import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request) {
  const formData = await request.formData();
  const email = formData.get("email");
  const password = formData.get("password");

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`,
    },
  });

  if (error) {
    return NextResponse.redirect(
      new URL(`/register?error=${encodeURIComponent(error.message)}`, request.url),
      { status: 302 }
    );
  }

  return NextResponse.redirect(
    new URL("/dashboard", request.url),
    { status: 302 }
  );
}
