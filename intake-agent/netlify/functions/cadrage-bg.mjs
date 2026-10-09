import { guard } from "../lib/session.mjs";
import { buildCadrage } from "../lib/cadrage.mjs";
import { store } from "../lib/fiche.mjs";
import { audit } from "../lib/audit.mjs";

// Builds the scoping file of a fiche in the background (1 to 3 minutes). The page polls the fiche.
export default async (req) => {
  const a = await guard(req, "fiche.dsi");
  if (a.error) return;
  let b = {};
  try { b = await req.json(); } catch {}
  const s = store(), id = String(b.id || "");
  const doc = await s.get(id, { type: "json" });
  if (!doc) return;
  doc.cadrageRunning = { since: new Date().toISOString() };
  delete doc.cadrageError;
  await s.setJSON(id, doc);
  try {
    const c = await buildCadrage(id);
    await audit(a, "dossier de cadrage généré", { target: doc, details: `v${c.version}, ${c.user_stories.length} user stories`, req });
  } catch (e) {
    console.error("cadrage error", e?.message);
    const d = await s.get(id, { type: "json" });
    if (d) { delete d.cadrageRunning; d.cadrageError = { at: new Date().toISOString(), message: String(e?.message || e).slice(0, 300) }; await s.setJSON(id, d); }
  }
};

export const config = { path: "/api/cadrage-bg", method: "POST", background: true };
