import { getStore } from "@netlify/blobs";
import { MESSAGING_CHANNEL, UPDATE } from "./prompts.mjs";
import { askJSON } from "./claude.mjs";
import { buildIntakeMessages } from "./intake.mjs";
import { transcribeAudio } from "./transcribe.mjs";
import { getConfig, intakeSystem, notice, noticeVersion } from "./config.mjs";
import { ingest, noteRetenu } from "./pieces.mjs";
import { eraseSubject } from "./privacy.mjs";
import { audit } from "./audit.mjs";
import { pushForFiche } from "./push.mjs";
import { sendWhatsApp, sendTeams, sendEmail } from "./adapters.mjs";
import {
  store as ficheStore, applyChanges, applyMesures, addEvent, scoreOf, FIELD_KEYS, SHORT, hasVal, valText,
  ficheForAgent, valueForAgent, addBusinessDays, frDate,
} from "./fiche.mjs";

// A conversation is one person on one messaging channel. It owns at most one draft fiche at a time
// and remembers what it is waiting for: a confirmation, or the answer to a nudge about a fiche.
export const CH_LABEL = { whatsapp: "WhatsApp", teams: "Teams" };
const convStore = () => getStore({ name: "conversations", consistency: "strong" });
const convKey = (channel, sender) => `${channel}/${String(sender).replace(/[^A-Za-z0-9+@._-]/g, "_").slice(0, 200)}`;

export const getConv = (channel, sender) => convStore().get(convKey(channel, sender), { type: "json" });
export async function saveConv(conv) {
  conv.updatedAt = new Date().toISOString();
  if (conv.messages.length > 150) conv.messages = conv.messages.slice(-150);
  await convStore().setJSON(convKey(conv.channel, conv.sender), conv);
}
export const deleteConv = (channel, sender) => convStore().delete(convKey(channel, sender));

const YES = /^\s*(oui|ok|okay|d'?accord|yes|yep|wakha|waxa|iyeh|iyyeh|ah|نعم|واخا|اه|ايه|valide[rz]?|je valide|confirme[rz]?|c'?est bon|parfait|go)(\b|\s|[.!,]|$)/i;
const NO = /^\s*(non|no|nope|la|lla|لا|pas encore|attends?|annule[rz]?)(\b|\s|[.!,]|$)/i;
const MY_DATA = /^\s*mes\s+donn[ée]es\s*[.!]?\s*$/i;
const ERASE = /^\s*supprimer\s+mes\s+donn[ée]es\s*[.!]?\s*$/i;
const STOP = /^\s*stop\s*[.!]?\s*$/i;
const RESUME = /^\s*reprendre\s*[.!]?\s*$/i;
const SEND = /^\s*(envoyer|envoie|envoyez|transmettre|transmets|transmettez|c'?est tout|termin[ée]|fini)(\b|\s|[.!,]|$)/i;

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const hasCore = (doc) => ["probleme", "processus"].every((k) => hasVal(doc.fiche?.[k]?.valeur));

function recap(doc) {
  const lines = ["probleme", "processus", "cout", "decision", "donnees_existantes"]
    .filter((k) => hasVal(doc.fiche?.[k]?.valeur))
    .map((k) => `- ${SHORT[k]} : ${trunc(valText(doc.fiche[k].valeur), 170)}`);
  return `Récapitulatif — ${doc.titre || "votre besoin"}\n${lines.join("\n")}`;
}

function askSubmit(conv, doc, say) {
  conv.awaiting = { type: "confirm_submit", ficheId: doc.id };
  say(`${recap(doc)}\n\nRépondez OUI pour transmettre cette fiche à la DSI, ou continuez à préciser.`, ["OUI, transmettre", "Je précise"]);
}

async function handleIntake(conv, text, files, say, at) {
  if (conv.awaiting?.type === "confirm_submit") conv.awaiting = null;
  const fs = ficheStore();
  let doc = conv.ficheId ? await fs.get(conv.ficheId, { type: "json" }) : null;
  if (doc && doc.statut !== "Brouillon") doc = null;
  if (!doc) {
    doc = {
      id: crypto.randomUUID(), titre: "", fiche: {}, score: 0, pret: false, alertes: [], statut: "Brouillon",
      origine: conv.channel, contact: { channel: conv.channel, sender: conv.sender, name: conv.name || "" },
      demandeur: conv.name || conv.sender, receivedAt: at, pending: [], events: [], transcript: [], echanges: 0,
    };
    addEvent(doc, { at, type: "capture", by: conv.channel, text: `Conversation ouverte sur ${CH_LABEL[conv.channel]}${conv.name ? ` par ${conv.name}` : ""}.` });
    conv.ficheId = doc.id;
  }
  if (SEND.test(text) && hasCore(doc)) { askSubmit(conv, doc, say); await fs.setJSON(doc.id, doc); return; }

  const state = {};
  for (const k of FIELD_KEYS) { const e = doc.fiche[k]; state[k] = e && hasVal(e.valeur) ? { valeur: e.valeur, statut: e.statut } : null; }
  const { pieces, blocks, refused } = files.length ? await ingest(files, { by: conv.name || conv.sender, canal: CH_LABEL[conv.channel] }) : { pieces: [], blocks: [], refused: [] };
  const names = pieces.map((p) => p.name).join(", ");
  const messages = buildIntakeMessages({
    context: `${MESSAGING_CHANNEL}\n\nCONTEXTE : date du jour ${frDate(at)}.${conv.name ? ` Interlocuteur : ${conv.name}.` : ""}`,
    history: doc.transcript.slice(-16),
    message: `ÉTAT ACTUEL DE LA FICHE (JSON, null = vide) :\n${JSON.stringify(state)}\n\nNOUVEAU MESSAGE DE L'UTILISATEUR :\n${text || "(pièce jointe sans texte)"}${refused.length ? `\n\n(Pièces non lues : ${refused.join(" ; ")}. Dis-le à l'utilisateur.)` : ""}`,
    blocks,
  });
  const cfg = await getConfig();
  const res = await askJSON({ system: intakeSystem(cfg), messages });
  applyChanges(doc.fiche, res.maj, at, CH_LABEL[conv.channel], { protectConfirmed: true });
  if (pieces.length) doc.pieces = [...(doc.pieces || []), ...noteRetenu(pieces, res.pieces)];
  doc.transcript.push({ role: "user", content: (text || "(pièce jointe)") + (names ? ` [pièce(s) jointe(s) : ${names}]` : "") }, { role: "assistant", content: String(res.message || "") });
  doc.echanges = (doc.echanges || 0) + 1;
  if (typeof res.titre === "string" && res.titre.trim()) doc.titre = res.titre.trim().slice(0, 80);
  if (Array.isArray(res.alertes)) doc.alertes = res.alertes.filter((a) => a && a.texte).slice(0, 8);
  doc.pret = res.pret === true;
  doc.score = scoreOf(doc.fiche);
  say(String(res.message || "C'est noté."), (Array.isArray(res.suggestions) ? res.suggestions : []).filter((s) => typeof s === "string").slice(0, 3));
  if (doc.pret && hasCore(doc)) askSubmit(conv, doc, say);
  await fs.setJSON(doc.id, doc);
}

// Loi 09-08 commands: what we hold, erasure (after confirmation), opting out of follow-ups.
async function myData(conv, say) {
  const fs = ficheStore();
  const ids = [...new Set([conv.ficheId, ...(conv.ficheIds || [])].filter(Boolean))];
  const docs = (await Promise.all(ids.map((id) => fs.get(id, { type: "json" })))).filter(Boolean);
  say(`Voici ce que nous conservons à votre sujet : votre nom et votre numéro sur ${CH_LABEL[conv.channel]}, cette conversation (${conv.messages.length} messages)${docs.length ? ` et ${docs.length} besoin(s) : ${docs.map((d) => `« ${d.titre || "sans titre"} » (${d.statut})`).join(", ")}` : ""}. Écrivez SUPPRIMER MES DONNÉES pour tout effacer.`);
}

async function submitDraft(conv, say, at) {
  const fs = ficheStore();
  const doc = await fs.get(conv.awaiting.ficheId, { type: "json" });
  conv.awaiting = null;
  if (!doc || doc.statut !== "Brouillon") { say("Cette fiche a déjà été transmise. Pour un nouveau besoin, décrivez-le simplement."); return; }
  const echeance = addBusinessDays(at, 5);
  Object.assign(doc, { statut: "À qualifier", submittedAt: at, echeance: echeance.toISOString(), score: scoreOf(doc.fiche) });
  if (conv.consent && !doc.consentement) doc.consentement = { ...conv.consent, canal: CH_LABEL[conv.channel] };
  addEvent(doc, { at, type: "transmise", by: "métier", text: `Fiche validée et transmise depuis ${CH_LABEL[conv.channel]} après ${doc.echanges || 0} échange(s).` });
  await fs.setJSON(doc.id, doc);
  conv.ficheIds = [...new Set([...(conv.ficheIds || []), doc.id])];
  conv.submitted = doc.id;
  await audit({ system: `${CH_LABEL[conv.channel]} — ${conv.name || conv.sender}` }, "fiche transmise", { target: doc });
  say(`C'est transmis. La DSI & TD vous répondra avant le ${frDate(echeance)}. Je reviendrai vers vous ici si une information doit être confirmée. Pour un autre besoin, écrivez-le simplement.`);
}

// Answer to a nudge (or a correction while a proposed update waits for confirmation).
async function handleFollowUp(conv, text, say, at) {
  const fs = ficheStore();
  const doc = await fs.get(conv.awaiting.ficheId, { type: "json" });
  const question = conv.awaiting.question || "";
  if (!doc) { conv.awaiting = null; return handleIntake(conv, text, null, say, at); }
  const value = valueForAgent(doc);
  const cfg = await getConfig();
  const input = `DATE DU JOUR : ${frDate(at)}\nSOURCE : métier (le porteur du besoin répond sur ${CH_LABEL[conv.channel]})\nQUESTION POSÉE PAR L'AGENT : ${question}\n\nFICHE ACTUELLE « ${doc.titre} » :\n${ficheForAgent(doc.fiche, Date.parse(at), cfg.ttl)}${value ? `\n\nINDICATEURS DE VALEUR :\n${JSON.stringify(value)}` : ""}\n\nNOUVELLE INFORMATION :\n${text}`;
  const res = await askJSON({ system: UPDATE, messages: [{ role: "user", content: input }] });
  const props = (Array.isArray(res.propositions) ? res.propositions : []).filter((p) => p && FIELD_KEYS.includes(p.champ));
  const mesures = Array.isArray(res.mesures) ? res.mesures.filter((m) => m && m.indicateurId) : [];
  if (!props.length && !mesures.length) {
    addEvent(doc, { at, type: "note", by: "métier", text: `Réponse sur ${CH_LABEL[conv.channel]} : ${trunc(text, 600)}` });
    doc.nudge = null;
    await fs.setJSON(doc.id, doc);
    conv.awaiting = null;
    say("Merci, c'est noté dans le suivi de votre besoin.");
    return;
  }
  conv.awaiting = { type: "confirm_update", ficheId: doc.id, question, resume: res.resume || "", props, mesures };
  const inds = doc.valeur?.indicateurs || [];
  const lines = [
    ...props.map((p) => `- ${SHORT[p.champ]} : ${trunc(valText(p.valeur), 160)}`),
    ...mesures.map((m) => `- Mesure « ${inds.find((i) => i.id === m.indicateurId)?.nom || "indicateur"} » : ${m.valeur}`),
  ];
  say(`Je mets à jour votre fiche « ${doc.titre} » :\n${lines.join("\n")}\n\nRépondez OUI pour confirmer.`, ["OUI", "Non"]);
}

async function applyAwaitingUpdate(conv, say, at) {
  const fs = ficheStore();
  const a = conv.awaiting; conv.awaiting = null;
  const doc = await fs.get(a.ficheId, { type: "json" });
  if (!doc) { say("Je ne retrouve plus cette fiche."); return; }
  const changes = Object.fromEntries((a.props || []).map((p) => [p.champ, { valeur: p.valeur, statut: p.statut === "déduit" ? "déclaré" : p.statut, note: p.raison }]));
  const changed = applyChanges(doc.fiche, changes, at, CH_LABEL[conv.channel]);
  const nm = applyMesures(doc, a.mesures, at, CH_LABEL[conv.channel]);
  doc.nudge = null;
  doc.score = scoreOf(doc.fiche);
  addEvent(doc, { at, type: "maj", by: "métier", text: `Réponse sur ${CH_LABEL[conv.channel]} : ${a.resume || "mise à jour confirmée"}${nm ? ` (${nm} mesure${nm > 1 ? "s" : ""} de valeur)` : ""}`, fields: changed, source: CH_LABEL[conv.channel] });
  await fs.setJSON(doc.id, doc);
  say("C'est noté, votre fiche est à jour. Merci !");
}

// Entry point for every inbound message, whatever the channel. Files: [{name, mime, data}] (an `image`
// {media_type, data} is accepted too). Returns the replies and, after a submission, the new fiche id.
export async function handleIncoming({ channel, sender, name, text, image, audio, files, ref, simulated = false }) {
  const at = new Date().toISOString();
  let conv = await getConv(channel, sender);
  const isNew = !conv;
  if (!conv) conv = { channel, sender, name: name || "", messages: [], ficheId: null, awaiting: null, createdAt: at, simulated };
  if (name) conv.name = name;
  if (ref) conv.ref = ref;
  const att = [...(Array.isArray(files) ? files : [])];
  if (image?.data) att.push({ name: "photo.jpg", mime: image.media_type || "image/jpeg", data: image.data });
  const inMsg = { dir: "in", at, kind: audio ? "audio" : att.length ? (att.every((f) => /^image\//.test(f.mime)) ? "image" : "file") : "text", text: text || "", files: att.map((f) => f.name) };
  const out = [];
  const say = (t, quick = []) => out.push({ text: t, quick });
  let erased = false;
  delete conv.submitted;
  try {
    const cfg = await getConfig();
    // First contact: the information notice required by loi 09-08, once per conversation.
    if (!conv.consent) {
      conv.consent = { at, version: noticeVersion(cfg) };
      say(notice(cfg, true));
      if (isNew) await audit({ system: `${CH_LABEL[channel]} — ${name || sender}` }, "information délivrée", { details: "Notice loi 09-08 envoyée au premier message" });
    }
    if (audio) {
      const tr = await transcribeAudio(audio.data, audio.mimeType);
      Object.assign(inMsg, { transcription: tr.transcription, langue: tr.langue, duree: audio.duree || null });
      text = tr.francais;
    }
    conv.messages.push(inMsg);
    text = (text || "").trim();
    const aw = conv.awaiting?.type;
    if (!text && !att.length) say("Je n'ai pas compris ce message. Pouvez-vous l'écrire ou l'enregistrer à nouveau ?");
    else if (MY_DATA.test(text)) await myData(conv, say);
    else if (ERASE.test(text)) { conv.awaiting = { type: "confirm_erase" }; say("Confirmez-vous la suppression de cette conversation, de vos brouillons et de vos coordonnées sur vos besoins transmis ? Les besoins eux-mêmes restent suivis par la DSI, sans votre nom. Répondez OUI pour confirmer.", ["OUI", "Non"]); }
    else if (aw === "confirm_erase" && YES.test(text)) {
      const r = await eraseSubject({ sender: conv.sender, ficheIds: [conv.ficheId, ...(conv.ficheIds || [])].filter(Boolean) });
      await audit({ system: `${CH_LABEL[channel]} — demande de la personne` }, "effacement de données personnelles", { details: `${r.fiches_anonymisees} fiche(s) anonymisée(s), ${r.brouillons_supprimes} brouillon(s) et ${r.conversations_supprimees} conversation(s) supprimés` });
      say("C'est fait : vos données ont été supprimées. Vous pouvez nous réécrire à tout moment pour un nouveau besoin.");
      erased = true;
    } else if (STOP.test(text)) { conv.optout = true; conv.awaiting = null; say("C'est noté : l'agent ne vous relancera plus ici. Écrivez REPRENDRE pour réactiver les relances."); }
    else if (RESUME.test(text)) { conv.optout = false; say("Les relances sont réactivées. Merci !"); }
    else if (aw === "confirm_erase") { conv.awaiting = null; say("D'accord, je ne supprime rien."); }
    else if (aw === "confirm_submit" && YES.test(text)) await submitDraft(conv, say, at);
    else if (aw === "confirm_update" && YES.test(text)) await applyAwaitingUpdate(conv, say, at);
    else if ((aw === "confirm_submit" || aw === "confirm_update") && NO.test(text)) {
      conv.awaiting = aw === "confirm_update" ? { ...conv.awaiting, type: "nudge" } : null;
      say(aw === "confirm_submit" ? "D'accord, je n'envoie rien pour l'instant. Qu'aimeriez-vous préciser ?" : "D'accord, je ne modifie rien. Qu'est-ce qui serait juste ?");
    } else if ((aw === "nudge" || aw === "confirm_update") && !att.length) await handleFollowUp(conv, text, say, at);
    else await handleIntake(conv, text, att, say, at);
  } catch (e) {
    console.error("channel error", e?.message);
    conv.lastError = { at, message: String(e?.message || e).slice(0, 300) };
    if (!conv.messages.includes(inMsg)) conv.messages.push(inMsg);
    say("Désolé, je n'ai pas pu traiter votre message. Pouvez-vous le renvoyer ?");
  }
  for (const m of out) conv.messages.push({ dir: "out", at: new Date().toISOString(), text: m.text, quick: m.quick });
  if (erased) conv = { channel, sender, name: "", messages: out.map((m) => ({ dir: "out", at, text: m.text, quick: [] })), ficheId: null, awaiting: null, createdAt: at, simulated, consent: null };
  else await saveConv(conv);
  return { conv, replies: out, submitted: conv.submitted || null };
}

// Sends replies through the real channel (no-op for the demo simulator).
export async function sendReplies(conv, replies, opts = {}) {
  if (conv.simulated) return false;
  let ok = true;
  for (const r of replies) {
    if (conv.channel === "whatsapp") ok = (await sendWhatsApp(conv.sender, r.text, r.quick, opts)) && ok;
    else if (conv.channel === "teams") ok = (await sendTeams(conv.ref, r.text, r.quick)) && ok;
  }
  return ok;
}

// Delivers a nudge to the fiche owner on the channel the fiche came from, plus a notification on every
// device that installed the app and follows the fiche. Returns a label of what was done.
export async function deliverNudge(doc, nudge) {
  const devices = await pushForFiche(doc.id, { title: `Question sur « ${String(doc.titre || "votre besoin").slice(0, 60)} »`, body: nudge.question }).catch(() => 0);
  const via = await deliverNudgeOnChannel(doc, nudge);
  return devices ? `${via} + notification sur ${devices} appareil${devices > 1 ? "s" : ""}` : via;
}

async function deliverNudgeOnChannel(doc, nudge) {
  const c = doc.contact;
  if (c && (c.channel === "whatsapp" || c.channel === "teams")) {
    const conv = (await getConv(c.channel, c.sender)) || { channel: c.channel, sender: c.sender, name: c.name || "", messages: [], ficheId: null, awaiting: null, createdAt: new Date().toISOString() };
    if (conv.optout) return `${CH_LABEL[c.channel]} (relances refusées par la personne) — application`;
    conv.awaiting = { type: "nudge", ficheId: doc.id, question: nudge.question };
    const text = `À propos de votre besoin « ${doc.titre} » : ${nudge.question}`;
    const quick = (nudge.suggestions || []).slice(0, 3);
    conv.messages.push({ dir: "out", at: new Date().toISOString(), text, quick, nudge: true });
    await saveConv(conv);
    const tmpl = Netlify.env.get("WHATSAPP_NUDGE_TEMPLATE");
    const sent = await sendReplies(conv, [{ text, quick }], c.channel === "whatsapp" && tmpl ? { template: tmpl } : {});
    return conv.simulated ? `${CH_LABEL[c.channel]} (simulateur)` : sent ? CH_LABEL[c.channel] : `${CH_LABEL[c.channel]} (non configuré)`;
  }
  if (doc.origine === "e-mail" && doc.demandeur && /@/.test(doc.demandeur)) {
    const sent = await sendEmail({ to: doc.demandeur, subject: `Votre besoin « ${doc.titre} »`, text: `Bonjour,\n\n${nudge.question}\n\nRépondez simplement à cet e-mail ou mettez à jour votre fiche en ligne.\n\n${(await getConfig()).signature}` });
    return sent ? "e-mail" : "application (e-mail non configuré)";
  }
  return "application";
}

// Tells the owner of a fiche about something that happened (merge, putting in touch, delivery), on the channel
// the need came from and as a notification on the devices that follow it. Expects no answer.
export async function informOwner(doc, { title, text, url, quiet = false }) {
  const devices = await pushForFiche(doc.id, { title, body: text, ...(url ? { url } : {}) }).catch(() => 0);
  const c = doc.contact;
  if (c && (c.channel === "whatsapp" || c.channel === "teams")) {
    const conv = await getConv(c.channel, c.sender);
    if (!conv || conv.optout) return devices;
    const msg = `${title} — ${text}`;
    conv.messages.push({ dir: "out", at: new Date().toISOString(), text: msg, quick: [], info: true });
    await saveConv(conv);
    const tmpl = Netlify.env.get("WHATSAPP_NUDGE_TEMPLATE");
    await sendReplies(conv, [{ text: msg, quick: [] }], c.channel === "whatsapp" && tmpl ? { template: tmpl } : {});
  } else if (!quiet && doc.origine === "e-mail" && doc.demandeur && /@/.test(doc.demandeur)) {
    await sendEmail({ to: doc.demandeur, subject: title, text: `Bonjour,\n\n${text}\n\n${(await getConfig()).signature}` });
  }
  return devices;
}
