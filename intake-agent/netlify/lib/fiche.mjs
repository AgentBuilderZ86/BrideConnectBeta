import { getStore } from "@netlify/blobs";

export const store = () => getStore({ name: "fiches", consistency: "strong" });

export const QUEUE_STATUTS = ["Brouillon", "À qualifier", "En qualification", "Qualifié — à instruire", "Réorienté", "Clos"];
const WEIGHTS = { direction: 5, responsable: 5, urgence: 5, probleme: 15, processus: 10, cout: 15, decision: 10, resultats: 5, donnees_existantes: 10, donnees_manquantes: 5, contraintes: 5, budget: 5, similaires: 5 };
const FACTOR = { "déduit": 0.5, "déclaré": 1, "confirmé": 1 };
export const FIELD_KEYS = Object.keys(WEIGHTS);

const hasVal = (v) => Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim().length > 0;

export function scoreOf(fiche) {
  let s = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    const e = fiche?.[k];
    if (e && hasVal(e.valeur)) s += w * (FACTOR[e.statut] ?? 1);
  }
  return Math.round(s);
}

// Applies agent/user changes {champ: {valeur, statut}} onto a fiche; returns the list of changed keys.
export function applyChanges(fiche, changes, at, source) {
  const changed = [];
  for (const [k, u] of Object.entries(changes || {})) {
    if (!WEIGHTS[k] || !u || typeof u !== "object") continue;
    let v = u.valeur;
    if (k === "resultats") v = (Array.isArray(v) ? v : [v]).filter((x) => typeof x === "string" && x.trim());
    else if (Array.isArray(v)) v = v.join(", ");
    if (!hasVal(v)) continue;
    const statut = ["déclaré", "déduit", "confirmé"].includes(u.statut) ? u.statut : "déduit";
    fiche[k] = { valeur: v, statut, note: typeof u.note === "string" ? u.note : (u.raison || ""), maj: at, source: source || "" };
    changed.push(k);
  }
  return changed;
}

export const isoOr = (v, fallback) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : fallback);

export function addEvent(doc, ev) {
  doc.events = Array.isArray(doc.events) ? doc.events : [];
  doc.events.push(ev);
  if (doc.events.length > 200) doc.events = doc.events.slice(-200);
}
