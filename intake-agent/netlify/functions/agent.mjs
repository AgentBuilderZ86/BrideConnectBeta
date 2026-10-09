import { MODES } from "../lib/prompts.mjs";
import { guard } from "../lib/session.mjs";
import { streamAgent } from "../lib/claude.mjs";
import { buildIntakeMessages } from "../lib/intake.mjs";
import { getConfig, intakeSystem } from "../lib/config.mjs";
import { ingest } from "../lib/pieces.mjs";

// Agent modes reserved to the DSI; "update" serves the requester (news on their own fiche).
const DSI_MODES = new Set(["observe", "nudge", "qualify", "indicateurs", "portfolio", "fusion"]);

export default async (req) => {
  let a = await guard(req, "fiche.create");
  if (a.error) return a.error;
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  body = body || {};

  const mode = MODES[body.mode];
  if (mode) {
    if (DSI_MODES.has(body.mode) && (a = await guard(req, "fiche.dsi")).error) return a.error;
    const input = String(body.input || "").slice(0, 80000);
    if (!input.trim()) return Response.json({ error: "empty input" }, { status: 400 });
    const system = body.mode === "qualify" ? (await getConfig()).qualify : mode.system;
    return streamAgent({ system, effort: mode.effort, messages: [{ role: "user", content: input }] });
  }

  // Intake turn, possibly with attachments: they are stored first, then sent to the agent.
  const files = Array.isArray(body.attachments) ? body.attachments : [];
  const { pieces, blocks, refused } = files.length
    ? await ingest(files, { by: a.session?.name || "web", canal: "web", sub: a.session?.sub || "" })
    : { pieces: [], blocks: [], refused: [] };
  const note = refused.length ? `\n\n(Pièces non lues : ${refused.join(" ; ")}. Dis-le à l'utilisateur.)` : "";
  const messages = buildIntakeMessages({ ...body, message: body.message ? String(body.message) + note : body.message, blocks });
  if (!messages) return Response.json({ error: "empty message" }, { status: 400 });
  return streamAgent({ system: intakeSystem(await getConfig()), messages, prelude: files.length ? { pieces, refused } : null });
};

export const config = {
  path: "/api/agent",
  method: "POST",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
