import { listFiches, valText, valueForAgent, frDate } from "./fiche.mjs";
import { askJSON } from "./claude.mjs";
import { PORTFOLIO } from "./prompts.mjs";
import { pilotStore } from "./pilot.mjs";

const F = ["direction", "urgence", "probleme", "processus", "cout", "decision", "resultats", "donnees_existantes", "donnees_manquantes", "contraintes", "budget"];

export async function buildPortfolio() {
  const all = (await listFiches()).filter((q) => q.statut !== "Brouillon" && q.statut !== "Fusionné");
  const s = pilotStore();
  if (!all.length) throw new Error("Aucun besoin transmis : rien à organiser.");
  const lines = all.map((q) => {
    const o = { id: q.id, titre: q.titre, statut: q.statut };
    for (const k of F) if (q.fiche?.[k]) o[k] = valText(q.fiche[k].valeur).slice(0, 600);
    if (q.qualif) o.qualification = {
      valeur: q.qualif.valeur?.note ?? null, faisabilite: q.qualif.faisabilite?.note ?? null, trajectoire: q.qualif.trajectoire?.code || null,
      bottleneck_actuel: q.qualif.bottleneck_actuel?.description || null, bottleneck_potentiel: q.qualif.bottleneck_potentiel?.description || null, prerequis: q.qualif.prerequis || [],
    };
    const v = valueForAgent(q); if (v) o.indicateurs_valeur = v;
    return JSON.stringify(o);
  }).join("\n");
  const res = await askJSON({ system: PORTFOLIO, effort: "medium", maxTokens: 32000, messages: [{ role: "user", content: `DATE DU JOUR : ${frDate(Date.now())}\n\nBESOINS (un JSON par ligne, ${all.length} au total) :\n${lines}` }] });
  if (!Array.isArray(res.cas_usage)) throw new Error("Réponse de l'agent inexploitable.");
  const ids = new Set(all.map((q) => q.id));
  res.cas_usage = res.cas_usage.map((c) => ({ ...c, besoins: (c.besoins || []).filter((id) => ids.has(id)) }));
  const prev = await s.get("portfolio", { type: "json" });
  if (prev) {
    const hist = (await s.get("portfolio-history", { type: "json" })) || [];
    hist.unshift(prev);
    await s.setJSON("portfolio-history", hist.slice(0, 10));
  }
  const doc = { ...res, at: new Date().toISOString(), version: (prev?.version || 0) + 1, besoins_consideres: all.length };
  await s.setJSON("portfolio", doc);
  return doc;
}
