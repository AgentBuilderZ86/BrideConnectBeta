import Anthropic from "@anthropic-ai/sdk";
import { RULES } from "../lib/rules.mjs";
import { authorized } from "../lib/auth.mjs";

// Credentials come from the Netlify AI Gateway (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL injected at runtime).
const client = new Anthropic();
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function buildMessages(body) {
  const history = Array.isArray(body.history) ? body.history.slice(-30) : [];
  const turns = [];
  const push = (role, content) => {
    const last = turns[turns.length - 1];
    if (last && last.role === role && typeof last.content === "string" && typeof content === "string") last.content += "\n\n" + content;
    else turns.push({ role, content });
  };
  push("user", String(body.context || "").slice(0, 500) || "CONTEXTE : (aucun)");
  for (const t of history) {
    if (!t || (t.role !== "user" && t.role !== "assistant") || typeof t.content !== "string" || !t.content.trim()) continue;
    push(t.role, t.content.slice(0, 8000));
  }
  const text = String(body.message || "").slice(0, 30000);
  if (!text.trim()) return null;
  const img = body.image;
  if (img && IMAGE_TYPES.has(img.media_type) && typeof img.data === "string" && img.data.length < 4_500_000) {
    const content = [
      { type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } },
      { type: "text", text },
    ];
    const last = turns[turns.length - 1];
    if (last.role === "user") last.content = [{ type: "text", text: last.content }, ...content];
    else turns.push({ role: "user", content });
  } else push("user", text);
  return turns;
}

export default async (req) => {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  const messages = buildMessages(body || {});
  if (!messages) return Response.json({ error: "empty message" }, { status: 400 });

  const enc = new TextEncoder();
  const line = (o) => enc.encode(JSON.stringify(o) + "\n");
  let stream;
  const rs = new ReadableStream({
    async start(controller) {
      try {
        stream = client.messages.stream({
          model: "claude-opus-5-5",
          max_tokens: 16000,
          system: RULES,
          output_config: { effort: "low" },
          messages,
        });
        stream.on("text", (delta) => controller.enqueue(line({ d: delta })));
        const final = await stream.finalMessage();
        controller.enqueue(line({ done: true, stop: final.stop_reason }));
      } catch (e) {
        const code = e instanceof Anthropic.RateLimitError ? "rate_limited"
          : e instanceof Anthropic.APIUserAbortError ? "cancelled"
          : "upstream_error";
        console.error("agent error", e?.status, e?.message);
        try { controller.enqueue(line({ error: code })); } catch {}
      } finally {
        try { controller.close(); } catch {}
      }
    },
    cancel() { stream?.abort(); },
  });
  return new Response(rs, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
};

export const config = {
  path: "/api/agent",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
