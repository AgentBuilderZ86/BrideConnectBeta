import { guard, isInternal } from "../lib/session.mjs";
import { buildSynergies, matchFiche } from "../lib/synergies.mjs";
import { pilotStore } from "../lib/pilot.mjs";
import { audit } from "../lib/audit.mjs";

// Background jobs: {match: id} after a submission (called by our own functions), or {} to review
// the whole portfolio (DSI page).
export default async (req) => {
  let b = {};
  try { b = await req.json(); } catch {}
  const internal = await isInternal(req);
  if (b.match) {
    if (!internal && (await guard(req, "fiche.dsi")).error) return;
    try { await matchFiche(String(b.match)); } catch (e) { console.error("match error", e?.message); }
    return;
  }
  const a = internal ? { system: "Agent" } : await guard(req, "portfolio.build");
  if (a.error) return;
  const s = pilotStore();
  await s.setJSON("synergies-running", { since: new Date().toISOString() });
  try {
    const r = await buildSynergies();
    await s.delete("synergies-error");
    await audit(a, "revue des doublons et synergies", { details: `${r.grappes.length} grappe(s) sur ${r.besoins_consideres} besoins`, req });
  } catch (e) {
    console.error("synergies error", e?.message);
    await s.setJSON("synergies-error", { at: new Date().toISOString(), message: String(e?.message || e).slice(0, 300) });
  } finally { await s.delete("synergies-running"); }
};

export const config = { path: "/api/synergies-bg", method: "POST", background: true };
