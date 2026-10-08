import { RULES } from "../lib/rules.mjs";
import { MODES } from "../lib/prompts.mjs";
import { authorized } from "../lib/auth.mjs";
import { streamAgent } from "../lib/claude.mjs";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function intakeMessages(body) {
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
  body = body || {};

  const mode = MODES[body.mode];
  if (mode) {
    const input = String(body.input || "").slice(0, 80000);
    if (!input.trim()) return Response.json({ error: "empty input" }, { status: 400 });
    return streamAgent({ system: mode.system, effort: mode.effort, messages: [{ role: "user", content: input }] });
  }

  const messages = intakeMessages(body);
  if (!messages) return Response.json({ error: "empty message" }, { status: 400 });
  return streamAgent({ system: RULES, messages });
};

export const config = {
  path: "/api/agent",
  method: "POST",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
