import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import RegisterForm from "@/components/auth/RegisterForm";

export const metadata = {
  title: "Create Account — Colab",
  description: "Create your free Colab account and start collaborating.",
};

export default async function RegisterPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative bg-chalk text-ink">
      <div className="w-full max-w-md relative z-10 animate-fade-in-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center">
              <img src="/favicon_io/apple-touch-icon.png" alt="Colab Logo" className="w-full h-full object-cover" />
            </div>
            <span className="text-xl font-bold text-ink">Colab</span>
          </div>
          <h1 className="text-2xl font-bold text-ink mb-1 font-serif">Create Account</h1>
          <p className="text-ink/60 text-sm">Start editing, offline-first, for free</p>
        </div>

        <div className="bg-[#EDEEE8] rounded-lg p-8 border border-stone">
          <RegisterForm />

          <div className="mt-6 text-center">
            <p className="text-ink/50 text-sm">
              Already have an account?{" "}
              <a href="/login" className="text-cobalt hover:underline font-medium transition-colors">
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
