import Anthropic from "@anthropic-ai/sdk";

// Credentials come from the Netlify AI Gateway (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL injected at runtime).
// The client is created on first use, inside a request: an instance started before the gateway variables
// were available would otherwise keep a client without credentials for its whole life.
let cached = null;
const envGet = (k) => { try { return globalThis.Netlify?.env?.get(k) || process.env[k] || null; } catch { return process.env[k] || null; } };
export function getClient() {
  if (cached && cached.apiKey) return cached;
  const apiKey = envGet("ANTHROPIC_API_KEY"), baseURL = envGet("ANTHROPIC_BASE_URL");
  cached = new Anthropic(apiKey ? { apiKey, ...(baseURL ? { baseURL } : {}) } : {});
  return cached;
}
export const client = { messages: { stream: (p) => getClient().messages.stream(p), create: (p) => getClient().messages.create(p) } };
export const MODEL = "claude-opus-5-5";

export function parseLoose(raw) {
  try { return JSON.parse(raw); } catch {}
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(raw.slice(a, b + 1)); } catch {} }
  return null;
}

// Streams the answer to the browser as NDJSON lines: {"d": text delta} … then {"done": true, "stop": reason} or
// {"error": code, "status", "type"}. The model request starts in the handler itself (not inside the stream
// callback); if streaming fails before any text arrives, the answer is fetched once more without streaming.
const errInfo = (e) => ({
  code: e instanceof Anthropic.RateLimitError ? "rate_limited" : e instanceof Anthropic.APIUserAbortError ? "cancelled" : "upstream_error",
  status: e?.status ?? null,
  type: String(e?.error?.error?.type || e?.name || "error").slice(0, 60),
  message: e?.status ? "" : String(e?.message || "").replace(/sk-[A-Za-z0-9_-]+/g, "[clé]").slice(0, 160),
});
export function streamAgent({ system, messages, effort = "low", prelude = null }) {
  const enc = new TextEncoder();
  const line = (o) => enc.encode(JSON.stringify(o) + "\n");
  const params = { model: MODEL, max_tokens: 16000, system, output_config: { effort }, messages };
  let stream, early = null;
  try { stream = client.messages.stream(params); } catch (e) { early = e; }
  const rs = new ReadableStream({
    async start(controller) {
      let sent = false;
      try {
        if (prelude) controller.enqueue(line(prelude));
        if (early) throw early;
        stream.on("text", (delta) => { sent = true; controller.enqueue(line({ d: delta })); });
        const final = await stream.finalMessage();
        controller.enqueue(line({ done: true, stop: final.stop_reason }));
      } catch (e) {
        const info = errInfo(e);
        console.error("agent stream error", info.status, info.type, e?.message);
        if (!sent && info.code === "upstream_error") {
          try {
            const final = await client.messages.create(params);
            const text = final.content.filter((b) => b.type === "text").map((b) => b.text).join("");
            controller.enqueue(line({ d: text }));
            controller.enqueue(line({ done: true, stop: final.stop_reason, fallback: true }));
            return;
          } catch (e2) {
            const i2 = errInfo(e2);
            console.error("agent fallback error", i2.status, i2.type, e2?.message);
            if (i2.message.includes("API key") || i2.message.includes("authentication")) cached = null;
            try { controller.enqueue(line({ error: i2.code, status: i2.status, type: i2.type, message: i2.message, stream: info })); } catch {}
            return;
          }
        }
        try { controller.enqueue(line({ error: info.code, status: info.status, type: info.type, message: info.message })); } catch {}
      } finally {
        try { controller.close(); } catch {}
      }
    },
    cancel() { stream?.abort(); },
  });
  return new Response(rs, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

// Server-side call that returns the parsed JSON answer (used by the inbound e-mail channel).
export async function askJSON({ system, messages, effort = "low" }) {
  const final = await client.messages.stream({ model: MODEL, max_tokens: 16000, system, output_config: { effort }, messages }).finalMessage();
  if (final.stop_reason === "refusal") throw new Error("refusal");
  const text = final.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const obj = parseLoose(text);
  if (!obj || typeof obj !== "object") throw new Error("invalid json");
  return obj;
}
