import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";

export const metadata = {
  title: "Sign In — Colab",
  description: "Sign in to your Colab account to access your documents.",
};

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative bg-chalk text-ink">
      <div className="w-full max-w-md relative z-10 animate-fade-in-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center">
              <img src="/favicon_io/apple-touch-icon.png" alt="Colab Logo" className="w-full h-full object-cover" />
            </div>
            <span className="text-xl font-bold text-ink">Colab</span>
          </div>
          <h1 className="text-2xl font-bold text-ink mb-1 font-serif">Welcome Back</h1>
          <p className="text-ink/60 text-sm">Sign in to your ledger to continue</p>
        </div>

        {/* Auth form card */}
        <div className="bg-[#EDEEE8] rounded-lg p-8 border border-stone">
          <LoginForm />

          <div className="mt-6 text-center">
            <p className="text-ink/50 text-sm">
              Don&apos;t have an account?{" "}
              <a href="/register" className="text-cobalt hover:underline font-medium transition-colors">
                Create one
              </a>
            </p>
          </div>
        </div>

        {/* Features preview */}
        <div className="mt-8 grid grid-cols-3 gap-4 border-t border-stone pt-6">
          {[
            { label: "Local-First" },
            { label: "CRDT Sync" },
            { label: "Version History" },
          ].map((f) => (
            <div key={f.label} className="text-center">
              <div className="text-xs font-semibold text-ink/40 tracking-wider uppercase">{f.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
