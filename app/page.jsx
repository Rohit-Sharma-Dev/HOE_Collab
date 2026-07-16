import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Colab — Local-First Collaborative Editor",
  description: "Edit documents offline, sync seamlessly, collaborate in real time with CRDT conflict resolution.",
};

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");
  else redirect("/login");
}
