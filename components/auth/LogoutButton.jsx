"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Client-side logout button.
 * Uses the Supabase browser client to sign out (clears cookies directly).
 */
export default function LogoutButton({ className = "" }) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();

    // Purge localStorage caches
    try {
      const cached = localStorage.getItem("collab_cached_documents");
      if (cached) {
        const documents = JSON.parse(cached);
        for (const doc of documents) {
          try {
            indexedDB.deleteDatabase(`collab-doc-${doc.id}`);
          } catch (e) {
            console.warn(`Failed to delete database for doc: ${doc.id}`);
          }
        }
      }
    } catch (e) {
      console.warn("Failed to clear IndexedDB databases via cached list:", e);
    }

    // Modern browsers' dynamic cleanup of matching databases
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name && db.name.startsWith("collab-doc-")) {
            indexedDB.deleteDatabase(db.name);
          }
        }
      }
    } catch (e) {
      console.warn("Failed to dynamically enumerate and clear IndexedDB databases:", e);
    }

    localStorage.removeItem("collab_cached_documents");
    localStorage.removeItem("collab_pending_creations");
    localStorage.removeItem("collab_pending_titles");
    sessionStorage.removeItem("collab_client_id");

    await supabase.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <button
      id="logout-btn"
      type="button"
      onClick={handleLogout}
      className={`btn btn-ghost py-1.5 px-3 text-xs ${className}`}
      aria-label="Sign out"
    >
      Sign out
    </button>
  );
}
