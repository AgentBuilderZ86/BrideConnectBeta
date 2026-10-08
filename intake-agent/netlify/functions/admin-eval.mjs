import { adminAuthorized } from "../lib/admin.mjs";
import { getConfig, intakeSystem } from "../lib/config.mjs";
import { client, MODEL, parseLoose } from "../lib/claude.mjs";
import { JUDGE } from "../lib/prompts.mjs";
import { buildIntakeMessages } from "../lib/intake.mjs";

// Runs one test case against the intake agent (current settings, or a draft not yet saved),
// then applies fixed checks and an AI judge against the case's expectations.
const STATUTS = new Set(["déclaré", "déduit", "confirmé"]);
const textOf = (m) => m.content.filter((b) => b.type === "text").map((b) => b.text).join("");

export default async (req) => {
  if (!adminAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let b;
  try { b = await req.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  const c = b?.case;
  if (!c?.message) return Response.json({ error: "case required" }, { status: 400 });
  const cfg = await getConfig();
  const draft = b.draft && typeof b.draft === "object" ? { ...cfg, ...b.draft } : cfg;
  const t0 = Date.now();
  const messages = buildIntakeMessages({
    context: `CONTEXTE : date du jour ${new Date().toLocaleDateString("fr-FR")}.`,
    history: [],
    message: `ÉTAT ACTUEL DE LA FICHE (JSON, null = vide) :\n{}\n\nBESOINS DÉJÀ TRANSMIS À LA DSI (pour détecter les doublons) :\n(aucun pour l'instant)\n\nNOUVEAU MESSAGE DE L'UTILISATEUR :\n${String(c.message).slice(0, 2000)}`,
  });
  let raw = "", res = null;
  try {
    const m = await client.messages.stream({ model: MODEL, max_tokens: 16000, system: intakeSystem(draft), output_config: { effort: "low" }, messages }).finalMessage();
    raw = textOf(m);
    res = parseLoose(raw);
  } catch (e) {
    return Response.json({ nom: c.nom, erreur: String(e?.message || e).slice(0, 300) });
  }
  const ms = Date.now() - t0;
  const msg = String(res?.message || "");
  const maj = res?.maj && typeof res.maj === "object" ? Object.values(res.maj) : [];
  const checks = [
    { nom: "Réponse JSON exploitable", ok: !!res && typeof res === "object" && !!msg },
    { nom: "3 questions au plus", ok: (msg.match(/\?/g) || []).length <= 3, detail: `${(msg.match(/\?/g) || []).length} point(s) d'interrogation` },
    { nom: "Statuts valides", ok: maj.every((u) => u && STATUTS.has(u.statut)) },
    { nom: "Rien de « confirmé » au premier échange", ok: !maj.some((u) => u && u.statut === "confirmé") },
    { nom: "Message court", ok: msg.length <= 900, detail: `${msg.length} caractères` },
    { nom: "Temps de réponse", ok: ms <= 30000, detail: `${Math.round(ms / 100) / 10} s` },
  ];
  let juge = null;
  if (c.attentes) {
    try {
      const j = await client.messages.stream({
        model: MODEL, max_tokens: 4000, system: JUDGE, output_config: { effort: "low" },
        messages: [{ role: "user", content: `MESSAGE DE L'UTILISATEUR :\n${c.message}\n\nRÉPONSE DE L'AGENT (JSON) :\n${raw.slice(0, 12000)}\n\nATTENTES :\n${c.attentes}` }],
      }).finalMessage();
      juge = parseLoose(textOf(j));
    } catch (e) { juge = { verdict: "indisponible", points: [String(e?.message || e).slice(0, 200)] }; }
  }
  return Response.json({ nom: c.nom, message: msg, maj: res?.maj || {}, alertes: res?.alertes || [], checks, juge, ms });
};

export const config = {
  path: "/api/admin/eval",
  method: "POST",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
