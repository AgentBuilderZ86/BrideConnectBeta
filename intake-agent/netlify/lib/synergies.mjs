import { listFiches, store as ficheStore, valText, addEvent, frDate } from "./fiche.mjs";
import { askJSON } from "./claude.mjs";
import { SYNERGIES, MATCH } from "./prompts.mjs";
import { pilotStore } from "./pilot.mjs";

// Duplicates and synergies across directions and sites.
const LIVE = (q) => !["Brouillon", "Clos", "Fusionné"].includes(q.statut);
const F = ["direction", "probleme", "processus", "cout", "decision", "donnees_existantes", "donnees_manquantes", "contraintes"];
function summary(q) {
  const o = { id: q.id, titre: q.titre, statut: q.statut, demandeur: q.owner?.name || q.contact?.name || q.demandeur || null };
  for (const k of F) if (q.fiche?.[k]) o[k] = valText(q.fiche[k].valeur).slice(0, 500);
  if (q.qualif?.trajectoire?.code) o.trajectoire = q.qualif.trajectoire.code;
  return JSON.stringify(o);
}

// Whole-portfolio review, run in the background from the DSI page.
export async function buildSynergies() {
  const all = (await listFiches()).filter(LIVE);
  if (all.length < 2) throw new Error("Il faut au moins deux besoins transmis pour chercher des synergies.");
  const res = await askJSON({ system: SYNERGIES, messages: [{ role: "user", content: `DATE DU JOUR : ${frDate(Date.now())}\n\nBESOINS (un JSON par ligne, ${all.length} au total) :\n${all.map(summary).join("\n")}` }] });
  const ids = new Set(all.map((q) => q.id));
  const grappes = (Array.isArray(res.grappes) ? res.grappes : []).map((g, i) => {
    const besoins = [...new Set((g.besoins || []).filter((id) => ids.has(id)))];
    return { id: `G-${String(i + 1).padStart(2, "0")}`, type: g.type === "doublon" ? "doublon" : "synergie", titre: String(g.titre || "").slice(0, 120), besoins,
      principal: besoins.includes(g.principal) ? g.principal : besoins[0], raison: String(g.raison || "").slice(0, 800), gain: String(g.gain || "").slice(0, 600),
      action: String(g.action || "").slice(0, 60), message_relation: String(g.message_relation || "").slice(0, 800) };
  }).filter((g) => g.besoins.length >= 2);
  const s = pilotStore();
  const prev = await s.get("synergies", { type: "json" });
  const doc = { at: new Date().toISOString(), version: (prev?.version || 0) + 1, synthese: String(res.synthese || ""), grappes, besoins_consideres: all.length };
  await s.setJSON("synergies", doc);
  return doc;
}

// Right after a submission: compares the new fiche with the others and links the close ones both ways.
export async function matchFiche(id) {
  const fs = ficheStore();
  const doc = await fs.get(id, { type: "json" });
  if (!doc || !LIVE(doc)) return [];
  const others = (await listFiches()).filter((q) => q.id !== id && LIVE(q));
  if (!others.length) return [];
  const res = await askJSON({ system: MATCH, messages: [{ role: "user", content: `NOUVEAU BESOIN :\n${summary(doc)}\n\nAUTRES BESOINS (un JSON par ligne) :\n${others.map(summary).join("\n")}` }] });
  const byId = new Map(others.map((q) => [q.id, q]));
  const at = new Date().toISOString();
  const proches = (Array.isArray(res.proches) ? res.proches : []).filter((p) => p && byId.has(p.id)).slice(0, 5)
    .map((p) => ({ id: p.id, type: p.type === "doublon" ? "doublon" : "synergie", raison: String(p.raison || "").slice(0, 400), at }));
  if (!proches.length) return [];
  const fresh = await fs.get(id, { type: "json" });
  const dir = (q) => valText(q.fiche?.direction?.valeur) || "direction non précisée";
  fresh.proches = [...(fresh.proches || []).filter((p) => !proches.some((x) => x.id === p.id)), ...proches.map((p) => ({ ...p, titre: byId.get(p.id).titre, direction: dir(byId.get(p.id)) }))];
  addEvent(fresh, { at, type: "synergie", by: "agent", text: proches.map((p) => `${p.type === "doublon" ? "Doublon possible" : "Synergie possible"} avec « ${byId.get(p.id).titre} » (${dir(byId.get(p.id))}) : ${p.raison}`).join(" ") });
  await fs.setJSON(id, fresh);
  for (const p of proches) {
    const o = await fs.get(p.id, { type: "json" });
    if (!o) continue;
    o.proches = [...(o.proches || []).filter((x) => x.id !== id), { id, type: p.type, raison: p.raison, titre: fresh.titre, direction: dir(fresh), at }];
    addEvent(o, { at, type: "synergie", by: "agent", text: `${p.type === "doublon" ? "Doublon possible" : "Synergie possible"} avec un nouveau besoin, « ${fresh.titre} » (${dir(fresh)}) : ${p.raison}` });
    await fs.setJSON(o.id, o);
  }
  return proches;
}
