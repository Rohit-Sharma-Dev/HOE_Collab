import { createClient } from "@/lib/supabase/server";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import * as Y from "yjs";

/**
 * POST /api/ai/diff-summary
 *
 * Given two version IDs, produces a streaming plain-English summary
 * of what changed between them using the Vercel AI SDK.
 *
 * Body: { document_id, version_a_id, version_b_id }
 */
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { document_id, version_a_id, version_b_id } = body;
  if (!document_id || !version_a_id || !version_b_id) {
    return new Response("document_id, version_a_id, version_b_id required", { status: 400 });
  }

  // Verify user has access
  const { data: access } = await supabase
    .from("document_collaborators")
    .select("role")
    .eq("document_id", document_id)
    .eq("user_id", user.id)
    .single();

  if (!access) return new Response("Access denied", { status: 403 });

  // Load both snapshots
  const { data: versions } = await supabase
    .from("document_versions")
    .select("id, label, created_at, snapshot")
    .in("id", [version_a_id, version_b_id])
    .eq("document_id", document_id);

  if (!versions || versions.length < 2) {
    return new Response("One or both versions not found", { status: 404 });
  }

  const vA = versions.find((v) => v.id === version_a_id);
  const vB = versions.find((v) => v.id === version_b_id);

  // Extract plain text from Yjs snapshots
  function extractText(b64Snapshot) {
    try {
      const bytes = new Uint8Array(Buffer.from(b64Snapshot, "base64"));
      const doc = new Y.Doc();
      Y.applyUpdate(doc, bytes);
      // Get the default text from the Tiptap 'default' XML fragment
      const xml = doc.getXmlFragment("default");
      return xml.toString().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  }

  const textA = extractText(vA.snapshot);
  const textB = extractText(vB.snapshot);

  const prompt = `You are a helpful writing assistant. Analyze the differences between two versions of a document and summarize the changes in 2-4 clear, concise sentences. Focus on meaningful content changes — ignore minor formatting tweaks.

Version A (${vA.label}, ${new Date(vA.created_at).toLocaleString()}):
---
${textA.slice(0, 3000)}
---

Version B (${vB.label}, ${new Date(vB.created_at).toLocaleString()}):
---
${textB.slice(0, 3000)}
---

Summarize what changed from Version A to Version B in plain English:`;

  try {
    const result = await streamText({
      model: openai("gpt-4o-mini"),
      prompt,
      maxTokens: 300,
    });

    return result.toDataStreamResponse();
  } catch (err) {
    console.error("AI diff-summary error:", err);
    return new Response("AI service unavailable", { status: 503 });
  }
}
