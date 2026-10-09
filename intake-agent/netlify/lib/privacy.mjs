import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import { store as ficheStore, listFiches, addEvent } from "./fiche.mjs";
import { deletePiece } from "./pieces.mjs";
import { removeForFiches } from "./push.mjs";
import { listAudit, purgeAudit } from "./audit.mjs";
import { lower } from "./session.mjs";

// Loi 09-08 (CNDP): rights of the people concerned (access, erasure) and retention.
// A subject is identified by any of: e-mail, phone (WhatsApp), Teams id, display name, or fiche ids.
const convStore = () => getStore({ name: "conversations", consistency: "strong" });
const digits = (s) => String(s || "").replace(/\D/g, "");
const ERASED = "Personne supprimée (droit d'effacement)";
export const hashSubject = (subj) => createHash("sha256").update(JSON.stringify(subj)).digest("hex").slice(0, 12);

export function normSubject(s = {}) {
  return {
    email: lower(s.email), phone: digits(s.phone), sub: String(s.sub || ""), sender: String(s.sender || ""),
    name: String(s.name || "").trim(), ficheIds: Array.isArray(s.ficheIds) ? s.ficheIds.map(String).slice(0, 100) : [],
  };
}
const isEmpty = (s) => !s.email && !s.phone && !s.sub && !s.sender && !s.name && !s.ficheIds.length;

export function ficheMatches(doc, s) {
  if (s.ficheIds.includes(doc.id)) return true;
  if (s.sub && doc.owner?.sub === s.sub) return true;
  if (s.email && [doc.owner?.email, doc.demandeur, doc.contact?.email].map(lower).includes(s.email)) return true;
  if (s.phone && s.phone.length >= 8 && [doc.contact?.sender, doc.demandeur].map(digits).includes(s.phone)) return true;
  if (s.sender && doc.contact?.sender === s.sender) return true;
  if (s.name && s.name.length >= 5 && [doc.contact?.name, doc.owner?.name].map(lower).includes(lower(s.name))) return true;
  return false;
}
function convMatches(c, s) {
  if (s.sender && c.sender === s.sender) return true;
  if (s.phone && s.phone.length >= 8 && digits(c.sender) === s.phone) return true;
  if (s.name && s.name.length >= 5 && lower(c.name) === lower(s.name)) return true;
  if (s.ficheIds.length && s.ficheIds.includes(c.ficheId)) return true;
  return false;
}
async function listConvs() {
  const st = convStore();
  const { blobs } = await st.list();
  return (await Promise.all(blobs.map(async (b) => ({ key: b.key, c: await st.get(b.key, { type: "json" }) })))).filter((x) => x.c);
}

// Everything held about a person, as one JSON document (right of access).
export async function exportSubject(subj) {
  const s = normSubject(subj);
  if (isEmpty(s)) throw new Error("personne non identifiée");
  const fiches = (await listFiches()).filter((d) => ficheMatches(d, s));
  const convs = (await listConvs()).filter((x) => convMatches(x.c, s)).map((x) => x.c);
  const names = new Set([s.name, ...fiches.map((d) => d.owner?.name || d.contact?.name)].filter(Boolean).map(lower));
  const journal = (await listAudit({ days: 366, limit: 2000 })).filter((e) => (s.email && lower(e.actor?.email) === s.email) || names.has(lower(e.actor?.name)));
  return {
    genere_le: new Date().toISOString(),
    cadre: "Droit d'accès — loi n° 09-08 relative à la protection des personnes physiques à l'égard du traitement des données à caractère personnel.",
    personne: { email: s.email || null, telephone: s.phone || null, nom: s.name || null },
    fiches: fiches.map((d) => ({ id: d.id, titre: d.titre, statut: d.statut, recue_le: d.submittedAt || d.receivedAt, canal: d.origine, demandeur: d.demandeur || null, contact: d.contact || null, fiche: d.fiche, pieces_jointes: (d.pieces || []).map((p) => ({ nom: p.name, type: p.label, date: p.at })), echanges: d.transcript || [], journal: d.events || [], consentement: d.consentement || null })),
    conversations: convs.map((c) => ({ canal: c.channel, identifiant: c.sender, nom: c.name, ouverte_le: c.createdAt, information: c.consent || null, messages: c.messages })),
    journal_audit: journal,
  };
}

// Removes personal data from a fiche, keeping the business need itself.
async function anonymize(doc, at, reason, names = []) {
  const scrub = (t) => { let x = String(t || ""); for (const n of names.filter((v) => v && v.length >= 4)) x = x.split(n).join("[supprimé]"); return x; };
  for (const p of doc.pieces || []) if (!p.supprime) { await deletePiece(p.id).catch(() => 0); Object.assign(p, { supprime: true, apercu: "", by: "" }); }
  if (doc.fiche?.responsable) doc.fiche.responsable = { ...doc.fiche.responsable, valeur: ERASED, note: "" };
  doc.transcript = [];
  doc.events = (doc.events || []).map((e) => ({ ...e, text: scrub(e.text) }));
  for (const k of ["owner", "contact", "reply"]) delete doc[k];
  doc.demandeur = ERASED;
  doc.coporteurs = (doc.coporteurs || []).map((c) => ({ ...c, demandeur: names.includes(c.demandeur) ? ERASED : c.demandeur }));
  doc.anonymiseAt = at;
  addEvent(doc, { at, type: "conformite", by: "système", text: reason });
}

// Right of erasure: drafts are deleted, submitted needs are anonymised, conversations deleted.
export async function eraseSubject(subj) {
  const s = normSubject(subj);
  if (isEmpty(s)) throw new Error("personne non identifiée");
  const at = new Date().toISOString(), fs = ficheStore();
  const fiches = (await listFiches()).filter((d) => ficheMatches(d, s));
  const out = { brouillons_supprimes: 0, fiches_anonymisees: 0, conversations_supprimees: 0 };
  for (const d of fiches) {
    const names = [s.name, s.email, s.phone, d.owner?.name, d.contact?.name, d.contact?.sender, d.demandeur, d.owner?.email].filter(Boolean).map(String);
    if (d.statut === "Brouillon") {
      for (const p of d.pieces || []) await deletePiece(p.id).catch(() => 0);
      await fs.delete(d.id); out.brouillons_supprimes++;
    } else {
      await anonymize(d, at, "Données personnelles du demandeur supprimées à sa demande (loi 09-08). Le besoin reste suivi par la DSI.", names);
      await fs.setJSON(d.id, d); out.fiches_anonymisees++;
    }
  }
  await removeForFiches(fiches.map((d) => d.id)).catch(() => 0);
  const st = convStore();
  for (const x of (await listConvs()).filter((x) => convMatches(x.c, s))) { await st.delete(x.key); out.conversations_supprimees++; }
  return out;
}

// Retention, run by the daily autopilot: deletes abandoned drafts, anonymises old closed needs,
// deletes idle conversations and old audit entries.
export async function applyRetention(cfg, now = Date.now()) {
  const c = cfg.conformite, DAY = 864e5, at = new Date(now).toISOString(), fs = ficheStore();
  const toMs = (v) => Date.parse(v || "") || 0;
  const out = { brouillons_supprimes: 0, fiches_anonymisees: 0, conversations_supprimees: 0, audit_purge: 0 };
  for (const d of await listFiches()) {
    const last = Math.max(toMs(d.receivedAt), toMs(d.submittedAt), ...(d.events || []).map((e) => toMs(e.at)));
    if (d.statut === "Brouillon" && now - last > c.brouillon_jours * DAY) {
      for (const p of d.pieces || []) await deletePiece(p.id).catch(() => 0);
      await fs.delete(d.id); out.brouillons_supprimes++;
    } else if (["Clos", "Réorienté", "Fusionné"].includes(d.statut) && !d.anonymiseAt && now - last > c.conservation_mois * 30.4 * DAY) {
      await anonymize(d, at, `Durée de conservation atteinte (${c.conservation_mois} mois) : données personnelles supprimées.`, [d.owner?.name, d.contact?.name, d.contact?.sender, d.demandeur].filter(Boolean));
      await fs.setJSON(d.id, d); out.fiches_anonymisees++;
    }
  }
  const st = convStore();
  for (const x of await listConvs()) if (now - toMs(x.c.updatedAt || x.c.createdAt) > c.conservation_mois * 30.4 * DAY) { await st.delete(x.key); out.conversations_supprimees++; }
  out.audit_purge = await purgeAudit(c.audit_mois).catch(() => 0);
  return out;
}
