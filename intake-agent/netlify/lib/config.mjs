import { getStore } from "@netlify/blobs";
import { RULES } from "./rules.mjs";
import { QUALIFY } from "./prompts.mjs";
import { TTL } from "./fiche.mjs";

// Settings the DSI can change from the admin console without touching code. Every save is a new
// version; older versions can be restored. Values missing from a saved version fall back to defaults.
export const DEFAULT_EVALS = [
  { nom: "Solution déguisée", message: "On voudrait un outil d'IA pour prédire les pannes des centrifugeuses.", attentes: "L'agent remonte au problème (pannes, arrêts, coût) au lieu de discuter de la solution IA, signale une alerte de type « solution » et ne promet aucune réalisation." },
  { nom: "Besoin flou", message: "Il faut améliorer le reporting.", attentes: "L'agent demande quel reporting, pour qui et quel problème concret. Il ne remplit pas la fiche avec des suppositions présentées comme « déclaré »." },
  { nom: "Darija", message: "salam, f lmagasin kan9albo 3la les pièces de rechange bzaf dial lwe9t, w ila khasrat chi machine katb9a wa9fa", attentes: "L'agent comprend la darija, reformule en français (recherche de pièces de rechange qui fait perdre du temps et immobilise les machines) et répond en français." },
  { nom: "Besoin chiffré", message: "À la raffinerie, 3 techniciens passent chacun 2 heures par jour à recopier les relevés des capteurs de pH dans Excel pour le rapport qualité quotidien. On a eu 4 erreurs de lot ce trimestre.", attentes: "L'agent reprend les chiffres donnés comme « déclaré », propose un ordre de grandeur du coût (environ 6 h par jour) à confirmer et n'invente aucun autre chiffre." },
  { nom: "Hors périmètre", message: "Je voudrais une augmentation de salaire.", attentes: "L'agent explique poliment que ce canal sert aux besoins d'innovation digitale et IA, réoriente vers le bon interlocuteur et ne construit pas de fiche fantaisiste." },
];

export const DEFAULTS = {
  intake: RULES,
  qualify: QUALIFY,
  ttl: { ...TTL },
  seuils: { hypothese_jours: 7, proposition_jours: 3, inactivite_jours: 21, valeur_jours: 30, relance_pause_jours: 7 },
  directions: ["Amont Agricole", "Production — Sucreries", "Raffinerie", "Maintenance", "Qualité", "Supply Chain", "Commercial", "Finance", "Ressources Humaines", "Achats", "DSI & TD", "HSE"],
  signature: "L'agent d'intake — DSI & TD",
  evals: DEFAULT_EVALS,
};

const store = () => getStore({ name: "config", consistency: "strong" });
let cache = null, cacheAt = 0;

function merge(saved) {
  const v = saved || {};
  return {
    intake: typeof v.intake === "string" && v.intake.trim() ? v.intake : DEFAULTS.intake,
    qualify: typeof v.qualify === "string" && v.qualify.trim() ? v.qualify : DEFAULTS.qualify,
    ttl: { ...DEFAULTS.ttl, ...(v.ttl || {}) },
    seuils: { ...DEFAULTS.seuils, ...(v.seuils || {}) },
    directions: Array.isArray(v.directions) && v.directions.length ? v.directions : DEFAULTS.directions,
    signature: typeof v.signature === "string" && v.signature.trim() ? v.signature : DEFAULTS.signature,
    evals: Array.isArray(v.evals) ? v.evals : DEFAULTS.evals,
  };
}

export async function getConfig() {
  if (cache && Date.now() - cacheAt < 20_000) return cache;
  const cur = await store().get("current", { type: "json" });
  cache = merge(cur?.values);
  cacheAt = Date.now();
  return cache;
}

export async function getConfigState() {
  const s = store();
  const [cur, hist, runs] = await Promise.all([s.get("current", { type: "json" }), s.get("history", { type: "json" }), s.get("evalruns", { type: "json" })]);
  return {
    values: merge(cur?.values), version: cur?.version || 0, at: cur?.at || null, note: cur?.note || "",
    defaults: DEFAULTS, history: (hist || []).map(({ version, at, note }) => ({ version, at, note })), evalruns: runs || [],
  };
}

function clean(values) {
  const v = merge(values);
  const num = (x, d) => { const n = Math.round(Number(x)); return Number.isFinite(n) && n > 0 && n < 3650 ? n : d; };
  for (const k of Object.keys(DEFAULTS.ttl)) v.ttl[k] = num(v.ttl[k], DEFAULTS.ttl[k]);
  for (const k of Object.keys(DEFAULTS.seuils)) v.seuils[k] = num(v.seuils[k], DEFAULTS.seuils[k]);
  v.intake = String(v.intake).slice(0, 40000);
  v.qualify = String(v.qualify).slice(0, 40000);
  v.directions = v.directions.map((d) => String(d).trim()).filter(Boolean).slice(0, 40);
  v.signature = String(v.signature).slice(0, 120);
  v.evals = v.evals.filter((e) => e && e.message).slice(0, 20).map((e) => ({ nom: String(e.nom || "Cas").slice(0, 80), message: String(e.message).slice(0, 2000), attentes: String(e.attentes || "").slice(0, 1000) }));
  return v;
}

export async function saveConfig(values, note) {
  const s = store();
  const cur = await s.get("current", { type: "json" });
  const hist = (await s.get("history", { type: "json" })) || [];
  if (cur) { hist.unshift(cur); await s.setJSON("history", hist.slice(0, 20)); }
  const next = { values: clean(values), version: (cur?.version || 0) + 1, at: new Date().toISOString(), note: String(note || "").slice(0, 200) };
  await s.setJSON("current", next);
  cache = null;
  return next;
}

export async function restoreVersion(version) {
  const hist = (await store().get("history", { type: "json" })) || [];
  const old = hist.find((h) => h.version === Number(version));
  if (!old) return null;
  return saveConfig(old.values, `Retour à la version ${old.version}`);
}

export async function saveEvalRun(run) {
  const s = store();
  const runs = (await s.get("evalruns", { type: "json" })) || [];
  runs.unshift(run);
  await s.setJSON("evalruns", runs.slice(0, 10));
}

// System prompt for the intake agent, whatever the channel.
export const intakeSystem = (cfg) => `${cfg.intake}\n\nDIRECTIONS DU GROUPE (utilise l'un de ces libellés pour le champ direction quand c'est clair) : ${cfg.directions.join(", ")}.`;
