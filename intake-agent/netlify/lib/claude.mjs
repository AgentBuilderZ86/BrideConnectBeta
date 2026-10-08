import Anthropic from "@anthropic-ai/sdk";

// Credentials come from the Netlify AI Gateway (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL injected at runtime).
export const client = new Anthropic();
export const MODEL = "claude-opus-5-5";

export function parseLoose(raw) {
  try { return JSON.parse(raw); } catch {}
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(raw.slice(a, b + 1)); } catch {} }
  return null;
}

// Streams the answer to the browser as NDJSON lines: {"d": text delta} … then {"done": true, "stop": reason} or {"error": code}.
// An optional `prelude` object is sent first (e.g. the stored attachments).
export function streamAgent({ system, messages, effort = "low", prelude = null }) {
  const enc = new TextEncoder();
  const line = (o) => enc.encode(JSON.stringify(o) + "\n");
  let stream;
  const rs = new ReadableStream({
    async start(controller) {
      try {
        if (prelude) controller.enqueue(line(prelude));
        stream = client.messages.stream({ model: MODEL, max_tokens: 16000, system, output_config: { effort }, messages });
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
