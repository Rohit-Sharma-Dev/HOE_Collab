"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Client-side register form.
 * Uses the Supabase browser client which handles auth cookies automatically.
 */
export default function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Full navigation to pick up new auth cookies in middleware
    window.location.href = "/dashboard";
  }

  return (
    <>
      {error && (
        <div
          className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-fade-in"
          role="alert"
        >
          {error}
        </div>
      )}

      <form id="register-form" onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor="reg-email"
            className="block text-sm font-medium text-ink/70 mb-2"
          >
            Email address
          </label>
          <input
            id="reg-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="input-base"
            placeholder="you@example.com"
            aria-label="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
        </div>

        <div>
          <label
            htmlFor="reg-password"
            className="block text-sm font-medium text-ink/70 mb-2"
          >
            Password
          </label>
          <input
            id="reg-password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="input-base"
            placeholder="Min. 8 characters"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        <button
          id="register-submit"
          type="submit"
          disabled={loading}
          className="btn btn-primary w-full justify-center py-3 text-base disabled:opacity-60"
          aria-label="Create account"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="spinner" style={{ width: 16, height: 16 }} />
              Creating account…
            </span>
          ) : (
            "Create account"
          )}
        </button>
      </form>
    </>
  );
}
