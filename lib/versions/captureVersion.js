import * as Y from "yjs";
import { createClient } from "@/lib/supabase/client";

/**
 * Captures a full Yjs state snapshot and saves it as a version row.
 *
 * @param {Y.Doc} ydoc
 * @param {string} docId
 * @param {string} label - Optional user-provided label
 * @returns {Promise<{id: string, created_at: string} | null>}
 */
function encodeHex(uint8array) {
  let hex = "\\x";
  const len = uint8array.length;
  for (let i = 0; i < len; i++) {
    const b = uint8array[i];
    hex += (b < 16 ? "0" : "") + b.toString(16);
  }
  return hex;
}

function decodeHex(value) {
  if (!value) return null;
  if (value.startsWith("\\x")) {
    const hex = value.slice(2);
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return arr;
  }
  try {
    const binary = atob(value);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      arr[i] = binary.charCodeAt(i);
    }
    return arr;
  } catch (err) {
    return null;
  }
}

/**
 * Captures a full Yjs state snapshot and saves it as a version row.
 *
 * @param {Y.Doc} ydoc
 * @param {string} docId
 * @param {string} label - Optional user-provided label
 * @returns {Promise<{id: string, created_at: string} | null>}
 */
export async function captureVersion(ydoc, docId, label = "") {
  const supabase = createClient();

  // Get the current user's ID for the created_by column
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error("captureVersion: not authenticated");
    return null;
  }

  // Encode the FULL document state (not just the diff)
  const snapshot = Y.encodeStateAsUpdate(ydoc);
  const hexSnapshot = encodeHex(snapshot);

  const { data, error } = await supabase
    .from("document_versions")
    .insert({
      document_id: docId,
      snapshot: hexSnapshot,
      created_by: user.id,
      label: label || `Version ${new Date().toLocaleString()}`,
    })
    .select("id, created_at, label")
    .single();

  if (error) {
    console.error("captureVersion: failed to save version", error);
    return null;
  }

  return data;
}

/**
 * Fetch all versions for a document, newest first.
 *
 * @param {string} docId
 * @returns {Promise<Array>}
 */
export async function fetchVersions(docId) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("document_versions")
    .select("id, label, created_at, created_by")
    .eq("document_id", docId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchVersions: failed to fetch", error);
    return [];
  }

  return data || [];
}

/**
 * Load a single version's snapshot bytes.
 *
 * @param {string} versionId
 * @returns {Promise<Uint8Array | null>}
 */
export async function loadVersionSnapshot(versionId) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("document_versions")
    .select("snapshot")
    .eq("id", versionId)
    .single();

  if (error || !data) return null;

  return decodeHex(data.snapshot);
}
