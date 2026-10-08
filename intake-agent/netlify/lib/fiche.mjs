import { getStore } from "@netlify/blobs";

export const store = () => getStore({ name: "fiches", consistency: "strong" });

export const QUEUE_STATUTS = ["Brouillon", "À qualifier", "En qualification", "Qualifié — à instruire", "En réalisation", "En production", "Réorienté", "Clos"];
const WEIGHTS = { direction: 5, responsable: 5, urgence: 5, probleme: 15, processus: 10, cout: 15, decision: 10, resultats: 5, donnees_existantes: 10, donnees_manquantes: 5, contraintes: 5, budget: 5, similaires: 5 };
const FACTOR = { "déduit": 0.5, "déclaré": 1, "confirmé": 1 };
export const FIELD_KEYS = Object.keys(WEIGHTS);
export const SHORT = { direction: "Direction", responsable: "Responsable", urgence: "Urgence", probleme: "Problème", processus: "Processus", cout: "Coût actuel", decision: "Décision améliorée", resultats: "Résultats attendus", donnees_existantes: "Données existantes", donnees_manquantes: "Données manquantes", contraintes: "Contraintes", budget: "Budget", similaires: "Initiatives similaires" };
// Days after which an answer must be re-validated with its owner.
export const TTL = { direction: 365, responsable: 365, urgence: 60, probleme: 240, processus: 180, cout: 90, decision: 240, resultats: 240, donnees_existantes: 180, donnees_manquantes: 180, contraintes: 180, budget: 120, similaires: 120 };

export const hasVal = (v) => Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim().length > 0;
export const valText = (v) => Array.isArray(v) ? v.join(", ") : String(v ?? "");
const toMs = (v) => typeof v === "number" ? v : (Date.parse(v || "") || null);
export const ageDays = (e, nowMs) => { const m = toMs(e && e.maj); return m ? Math.max(0, Math.floor((nowMs - m) / 864e5)) : null; };
export const isStale = (k, e, nowMs) => { const a = ageDays(e, nowMs); return a !== null && a > (TTL[k] || 180); };
export const frDate = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Casablanca" });

export function scoreOf(fiche) {
  let s = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    const e = fiche?.[k];
    if (e && hasVal(e.valeur)) s += w * (FACTOR[e.statut] ?? 1);
  }
  return Math.round(s);
}

// Applies changes {champ: {valeur, statut}} onto a fiche; returns the changed keys.
// With protectConfirmed, a guess ("déduit") never replaces a value the owner confirmed.
export function applyChanges(fiche, changes, at, source, { protectConfirmed = false } = {}) {
  const changed = [];
  for (const [k, u] of Object.entries(changes || {})) {
    if (!WEIGHTS[k] || !u || typeof u !== "object") continue;
    let v = u.valeur;
    if (k === "resultats") v = (Array.isArray(v) ? v : [v]).filter((x) => typeof x === "string" && x.trim());
    else if (Array.isArray(v)) v = v.join(", ");
    if (!hasVal(v)) continue;
    const statut = ["déclaré", "déduit", "confirmé"].includes(u.statut) ? u.statut : "déduit";
    if (protectConfirmed && fiche[k]?.statut === "confirmé" && statut === "déduit") continue;
    fiche[k] = { valeur: v, statut, note: typeof u.note === "string" ? u.note : (u.raison || ""), maj: at, source: source || "" };
    changed.push(k);
  }
  return changed;
}

// Records measured values against the value indicators of a fiche; returns how many were stored.
export function applyMesures(doc, mesures, at, source) {
  const inds = doc.valeur?.indicateurs || [];
  if (!inds.length || !Array.isArray(mesures)) return 0;
  doc.valeur.mesures = Array.isArray(doc.valeur.mesures) ? doc.valeur.mesures : [];
  let n = 0;
  for (const m of mesures) {
    const ind = inds.find((i) => i.id === m.indicateurId) || inds.find((i) => i.nom.toLowerCase() === String(m.indicateur || "").toLowerCase());
    if (!ind || m.valeur === undefined || m.valeur === null || String(m.valeur).trim() === "") continue;
    doc.valeur.mesures.push({ indicateurId: ind.id, valeur: m.valeur, commentaire: String(m.commentaire || "").slice(0, 300), source: source || "", at });
    n++;
  }
  return n;
}

export function ficheForAgent(fiche, nowMs) {
  const o = {};
  for (const k of FIELD_KEYS) {
    const e = fiche?.[k];
    o[k] = e && hasVal(e.valeur) ? { valeur: e.valeur, statut: e.statut, anciennete_jours: ageDays(e, nowMs), perime: isStale(k, e, nowMs) } : null;
  }
  return JSON.stringify(o, null, 1);
}

export function valueForAgent(doc) {
  const inds = doc.valeur?.indicateurs || [];
  if (!inds.length) return null;
  const ms = doc.valeur.mesures || [];
  return inds.map((i) => {
    const last = ms.filter((m) => m.indicateurId === i.id).sort((a, b) => String(a.at).localeCompare(String(b.at))).pop();
    return { id: i.id, nom: i.nom, unite: i.unite || "", avant: i.avant ?? null, cible: i.cible ?? null, derniere_mesure: last ? { valeur: last.valeur, date: last.at } : null };
  });
}

export function addBusinessDays(date, n) {
  const r = new Date(date); let added = 0;
  while (added < n) { r.setDate(r.getDate() + 1); const w = r.getDay(); if (w !== 0 && w !== 6) added++; }
  return r;
}

export const isoOr = (v, fallback) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : fallback);

export function addEvent(doc, ev) {
  doc.events = Array.isArray(doc.events) ? doc.events : [];
  doc.events.push(ev);
  if (doc.events.length > 200) doc.events = doc.events.slice(-200);
}

export async function listFiches() {
  const s = store();
  const { blobs } = await s.list();
  return (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
}
