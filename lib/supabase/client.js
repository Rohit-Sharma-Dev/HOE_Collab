import { createBrowserClient } from "@supabase/ssr";

let client;

/**
 * Returns a singleton Supabase browser client.
 * Safe to call multiple times — reuses the same instance.
 */
export function createClient() {
  if (client) return client;
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  return client;
}
