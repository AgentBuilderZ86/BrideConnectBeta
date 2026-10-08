import { RULES } from "../lib/rules.mjs";
import { MODES } from "../lib/prompts.mjs";
import { authorized } from "../lib/auth.mjs";
import { streamAgent } from "../lib/claude.mjs";
import { buildIntakeMessages } from "../lib/intake.mjs";

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

  const messages = buildIntakeMessages(body);
  if (!messages) return Response.json({ error: "empty message" }, { status: 400 });
  return streamAgent({ system: RULES, messages });
};

export const config = {
  path: "/api/agent",
  method: "POST",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
