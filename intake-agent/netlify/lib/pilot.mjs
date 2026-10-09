import { getStore } from "@netlify/blobs";
import { listFiches, store as ficheStore, FIELD_KEYS, SHORT, hasVal, valText, ageDays, isStale, valueForAgent, addEvent, frDate } from "./fiche.mjs";
import { askJSON } from "./claude.mjs";
import { NUDGE, DIGEST } from "./prompts.mjs";
import { deliverNudge } from "./channels.mjs";
import { sendEmail } from "./adapters.mjs";
import { getConfig } from "./config.mjs";
import { applyRetention } from "./privacy.mjs";
import { audit } from "./audit.mjs";

// Autopilot: a daily round that keeps every fiche true without anyone filling a form,
// and a weekly digest for the DSI. Both log what they did so the team can audit the agent.
export const pilotStore = () => getStore({ name: "pilot", consistency: "strong" });
const DAY = 864e5;
const ACTIVE = (s) => !["Brouillon", "Clos", "Réorienté", "Fusionné"].includes(s);
const toMs = (v) => Date.parse(v || "") || null;
const filled = (q, k) => q.fiche && q.fiche[k] && hasVal(q.fiche[k].valeur);

function bdBetween(a, b) {
  const d = new Date(a); d.setHours(0, 0, 0, 0);
  const e = new Date(b); e.setHours(0, 0, 0, 0);
  const sign = d <= e ? 1 : -1; let n = 0, guard = 0;
  while (d.getTime() !== e.getTime() && guard++ < 3000) { d.setDate(d.getDate() + sign); const w = d.getDay(); if (w !== 0 && w !== 6) n += sign; }
  return n;
}
const lastEventMs = (q) => (q.events || []).map((e) => toMs(e.at)).filter(Boolean).sort((a, b) => a - b).pop() || toMs(q.submittedAt);

const DEFAULT_SEUILS = { hypothese_jours: 7, proposition_jours: 3, inactivite_jours: 21, valeur_jours: 30, relance_pause_jours: 7 };
export function diagnose(q, now, cfg = {}) {
  const S = { ...DEFAULT_SEUILS, ...(cfg.seuils || {}) };
  const stale = FIELD_KEYS.filter((k) => filled(q, k) && isStale(k, q.fiche[k], now, cfg.ttl));
  const deduits = FIELD_KEYS.filter((k) => filled(q, k) && q.fiche[k].statut === "déduit" && (ageDays(q.fiche[k], now) ?? 0) >= S.hypothese_jours);
  const pendingOld = (q.pending || []).filter((p) => now - (toMs(p.at) || now) > S.proposition_jours * DAY).length;
  const last = lastEventMs(q);
  const inactiveDays = last ? Math.floor((now - last) / DAY) : null;
  const dd = q.echeance ? bdBetween(now, q.echeance) : null;
  const late = dd !== null && dd < 0 && ["À qualifier", "En qualification"].includes(q.statut);
  const inds = q.valeur?.indicateurs || [];
  const lastMeasure = (q.valeur?.mesures || []).map((m) => toMs(m.at)).filter(Boolean).sort((a, b) => a - b).pop();
  const prodDays = q.productionAt ? Math.floor((now - toMs(q.productionAt)) / DAY) : null;
  const valueDue = q.statut === "En production" && inds.length > 0 && prodDays !== null && prodDays >= S.valeur_jours && (!lastMeasure || now - lastMeasure > S.valeur_jours * DAY);
  const nudgeBlocked = !!(q.nudge && now - (toMs(q.nudge.at) || 0) < S.relance_pause_jours * DAY);
  const reasons = [];
  if (stale.length) reasons.push(`${stale.length} info(s) périmée(s)`);
  if (deduits.length) reasons.push(`${deduits.length} hypothèse(s) non confirmée(s)`);
  if (pendingOld) reasons.push(`${pendingOld} proposition(s) sans réponse`);
  if (inactiveDays !== null && inactiveDays >= S.inactivite_jours) reasons.push(`inactif depuis ${inactiveDays} j`);
  if (late) reasons.push(`retour DSI en retard de ${-dd} j ouvrés`);
  if (valueDue) reasons.push("valeur à mesurer");
  return { stale, deduits, pendingOld, inactiveDays, dd, late, valueDue, prodDays, nudgeBlocked, reasons };
}

async function appendLog(entry) {
  const s = pilotStore();
  const log = (await s.get("runs", { type: "json" })) || [];
  log.unshift(entry);
  await s.setJSON("runs", log.slice(0, 40));
}

export async function getPilotState() {
  const s = pilotStore();
  const [runs, digests, running] = await Promise.all([s.get("runs", { type: "json" }), s.get("digests", { type: "json" }), s.get("running", { type: "json" })]);
  return { runs: runs || [], digests: digests || [], running: running || null };
}

export async function runDaily({ offsetDays = 0, trigger = "planifié" } = {}) {
  const now = Date.now() + offsetDays * DAY, at = new Date(now).toISOString();
  const cfg = await getConfig();
  const fiches = (await listFiches()).filter((q) => ACTIVE(q.statut));
  const cands = fiches.map((q) => ({ q, d: diagnose(q, now, cfg) })).filter(({ d }) => !d.nudgeBlocked && d.reasons.length);
  let relances = [];
  if (cands.length) {
    const lines = cands.map(({ q, d }) => JSON.stringify({
      id: q.id, titre: q.titre, statut: q.statut, porteur: valText(q.fiche?.responsable?.valeur) || q.contact?.name || null,
      canal: q.contact?.channel || q.origine || "web",
      jours_depuis_transmission: q.submittedAt ? Math.floor((now - toMs(q.submittedAt)) / DAY) : null,
      jours_depuis_dernier_evenement: d.inactiveDays, jours_ouvres_avant_echeance_dsi: d.dd,
      hypotheses_non_confirmees: d.deduits.map((k) => ({ champ: SHORT[k], valeur: valText(q.fiche[k].valeur) })),
      informations_perimees: d.stale.map((k) => ({ champ: SHORT[k], valeur: valText(q.fiche[k].valeur), anciennete_jours: ageDays(q.fiche[k], now) })),
      propositions_en_attente: (q.pending || []).length,
      suivi_valeur: q.statut === "En production" ? { jours_depuis_mise_en_production: d.prodDays, indicateurs: valueForAgent(q) } : null,
    })).join("\n");
    const res = await askJSON({ system: NUDGE, messages: [{ role: "user", content: `DATE DU JOUR : ${frDate(now)}\n\nBESOINS SUIVIS (un JSON par ligne) :\n${lines}` }] });
    const ids = new Set(cands.map((c) => c.q.id));
    relances = (Array.isArray(res.relances) ? res.relances : []).filter((n) => n && n.question && ids.has(n.id));
  }
  const s = ficheStore(), done = [];
  for (const n of relances) {
    const doc = await s.get(n.id, { type: "json" });
    if (!doc) continue;
    if (n.destinataire === "DSI") {
      addEvent(doc, { at, type: "note", by: "pilote", text: `Rappel DSI (tournée automatique) : ${n.question}` });
      done.push({ id: doc.id, titre: doc.titre, destinataire: "DSI", motif: n.motif || "", question: n.question, via: "journal" });
    } else {
      doc.nudge = { question: String(n.question).slice(0, 600), motif: String(n.motif || "").slice(0, 300), suggestions: (n.suggestions || []).slice(0, 3).map(String), at, auto: true };
      const via = await deliverNudge(doc, doc.nudge).catch(() => "application");
      addEvent(doc, { at, type: "relance", by: "pilote", text: `Relance automatique (${via}) : « ${doc.nudge.question} »` });
      done.push({ id: doc.id, titre: doc.titre, destinataire: "métier", motif: n.motif || "", question: n.question, via });
    }
    await s.setJSON(doc.id, doc);
  }
  // Loi 09-08 retention, always on the real date (never the demo clock).
  const retention = await applyRetention(cfg).catch((e) => ({ erreur: String(e?.message || e).slice(0, 200) }));
  const purged = (retention.brouillons_supprimes || 0) + (retention.fiches_anonymisees || 0) + (retention.conversations_supprimees || 0);
  if (purged) await audit({ system: "Pilotage automatique" }, "conservation appliquée", { details: JSON.stringify(retention) });
  for (const n of done) await audit({ system: "Pilotage automatique" }, "relance envoyée", { target: n, details: `${n.destinataire} via ${n.via}` });
  const entry = { job: "daily", at, realAt: new Date().toISOString(), trigger, offsetDays, examines: fiches.length, candidats: cands.map(({ q, d }) => ({ id: q.id, titre: q.titre, raisons: d.reasons })), relances: done, retention };
  await appendLog(entry);
  return entry;
}

export function computeKpis(all, now, cfg = {}) {
  const recus = all.filter((q) => q.statut !== "Brouillon");
  const firstDsi = (q) => (q.events || []).filter((e) => ["statut", "reponse", "qualif"].includes(e.type)).map((e) => toMs(e.at)).filter(Boolean).sort((a, b) => a - b)[0];
  const delays = recus.map((q) => { const f = firstDsi(q), s0 = toMs(q.submittedAt); return f && s0 ? Math.max(0, bdBetween(s0, f)) : null; }).filter((x) => x !== null);
  const within7 = (ms) => ms && now - ms <= 7 * DAY && ms <= now;
  const evs = recus.flatMap((q) => q.events || []);
  return {
    recus: recus.length,
    nouveaux_7j: recus.filter((q) => within7(toMs(q.submittedAt))).length,
    brouillons: all.length - recus.length,
    en_attente_dsi: recus.filter((q) => ["À qualifier", "En qualification"].includes(q.statut)).length,
    en_retard: recus.filter((q) => diagnose(q, now, cfg).late).length,
    a_jour_pct: recus.length ? Math.round(100 * recus.filter((q) => !diagnose(q, now, cfg).stale.length).length / recus.length) : null,
    delai_premiere_reponse_jours: delays.length ? Math.round(10 * delays.reduce((a, b) => a + b, 0) / delays.length) / 10 : null,
    en_realisation: recus.filter((q) => q.statut === "En réalisation").length,
    en_production: recus.filter((q) => q.statut === "En production").length,
    valeur_mesuree: recus.filter((q) => q.statut === "En production" && (q.valeur?.mesures || []).length).length,
    relances_7j: evs.filter((e) => e.type === "relance" && within7(toMs(e.at))).length,
    maj_metier_7j: evs.filter((e) => e.type === "maj" && within7(toMs(e.at))).length,
  };
}

export async function runWeekly({ offsetDays = 0, trigger = "planifié" } = {}) {
  const now = Date.now() + offsetDays * DAY, at = new Date(now).toISOString();
  const cfg = await getConfig();
  const all = await listFiches();
  const kpis = computeKpis(all, now, cfg);
  const lines = all.filter((q) => q.statut !== "Brouillon").map((q) => {
    const d = diagnose(q, now, cfg);
    return JSON.stringify({
      id: q.id, titre: q.titre, statut: q.statut, direction: valText(q.fiche?.direction?.valeur) || null,
      jours_depuis_transmission: q.submittedAt ? Math.floor((now - toMs(q.submittedAt)) / DAY) : null,
      signaux: d.reasons, qualification: q.qualif ? `V${q.qualif.valeur?.note ?? "?"} F${q.qualif.faisabilite?.note ?? "?"} trajectoire ${q.qualif.trajectoire?.code || "?"}` : null,
      valeur: valueForAgent(q), derniers_evenements: (q.events || []).slice(-3).map((e) => `${frDate(e.at)} ${e.text}`),
    });
  }).join("\n");
  const res = await askJSON({ system: DIGEST, messages: [{ role: "user", content: `SEMAINE SE TERMINANT LE ${frDate(now)}\n\nINDICATEURS :\n${JSON.stringify(kpis)}\n\nBESOINS (un JSON par ligne) :\n${lines || "(aucun)"}` }] });
  const digest = { at, realAt: new Date().toISOString(), trigger, offsetDays, kpis, titre: res.titre || "Bilan hebdomadaire", synthese: res.synthese || "", decisions: res.decisions || [], alertes: res.alertes || [], bonnes_nouvelles: res.bonnes_nouvelles || [] };
  const s = pilotStore();
  const digests = (await s.get("digests", { type: "json" })) || [];
  digests.unshift(digest);
  await s.setJSON("digests", digests.slice(0, 12));
  const to = Netlify.env.get("DSI_EMAIL");
  const mailed = to ? await sendEmail({
    to, subject: digest.titre,
    text: `${digest.synthese}\n\nDécisions à prendre :\n${digest.decisions.map((x) => `- ${x.titre} : ${x.decision}`).join("\n") || "- aucune"}\n\nAlertes :\n${digest.alertes.map((x) => "- " + x).join("\n") || "- aucune"}\n\nBonnes nouvelles :\n${digest.bonnes_nouvelles.map((x) => "- " + x).join("\n") || "- aucune"}`,
  }).catch(() => false) : false;
  await appendLog({ job: "weekly", at, realAt: digest.realAt, trigger, offsetDays, titre: digest.titre, envoye: mailed ? to : null, decisions: digest.decisions.length });
  return digest;
}
