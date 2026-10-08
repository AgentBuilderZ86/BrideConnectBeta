import { authorized } from "../lib/auth.mjs";
import { askJSON } from "../lib/claude.mjs";
import { RULES } from "../lib/rules.mjs";
import { EMAIL_CHANNEL } from "../lib/prompts.mjs";
import { store, applyChanges, addEvent, scoreOf } from "../lib/fiche.mjs";

// Inbound e-mail channel. Accepts the JSON webhook of an inbound e-mail service (Postmark format:
// From, FromName, Subject, TextBody) or a simple {from, subject, text} body. Production webhooks
// authenticate with ?token=<INBOUND_TOKEN>; the demo page uses the demo code header.
function okToken(req) {
  const t = Netlify.env.get("INBOUND_TOKEN");
  return !!t && new URL(req.url).searchParams.get("token") === t;
}

async function sendReply({ to, subject, text }) {
  const key = Netlify.env.get("RESEND_API_KEY"), from = Netlify.env.get("RESEND_FROM");
  if (!key || !from) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!r.ok) console.error("resend error", r.status, await r.text());
  return r.ok;
}

export default async (req, context) => {
  if (!okToken(req) && !authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let b;
  try { b = await req.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  const from = String(b.From || b.from || "").slice(0, 200);
  const fromName = String(b.FromName || b.fromName || "").slice(0, 120);
  const subject = String(b.Subject || b.subject || "").slice(0, 300);
  const text = String(b.StrippedTextReply || b.TextBody || b.text || "").slice(0, 20000);
  if (!from || !text.trim()) return Response.json({ error: "missing from or body" }, { status: 400 });

  const now = new Date().toISOString();
  const emailText = `De : ${fromName ? fromName + " <" + from + ">" : from}\nObjet : ${subject}\n\n${text}`;
  const message = `ÉTAT ACTUEL DE LA FICHE (JSON, null = vide) :\n{}\n\nNOUVEAU MESSAGE DE L'UTILISATEUR (reçu par e-mail) :\n${emailText}`;
  let res;
  try {
    res = await askJSON({ system: RULES, messages: [{ role: "user", content: `${EMAIL_CHANNEL}\n\nCONTEXTE : date du jour ${new Date().toLocaleDateString("fr-FR")}.${fromName ? ` Expéditeur : ${fromName}.` : ""}\n\n${message}` }] });
  } catch (e) {
    console.error("inbound agent error", e?.message);
    return Response.json({ error: "agent failed" }, { status: 502 });
  }

  const id = crypto.randomUUID();
  const fiche = {};
  applyChanges(fiche, res.maj, now, "e-mail");
  const link = `${context.site?.url || new URL(req.url).origin}/?fiche=${id}`;
  const replyText = `${String(res.message || "").trim()}\n\nCompléter ma fiche en ligne : ${link}`;
  const reply = { to: from, subject: subject ? `Re: ${subject}` : "Votre besoin — Innovation Digitale & IA", body: replyText, sent: false };
  const doc = {
    id, titre: String(res.titre || subject || "Besoin reçu par e-mail").slice(0, 80), fiche, score: scoreOf(fiche),
    pret: res.pret === true, alertes: Array.isArray(res.alertes) ? res.alertes.slice(0, 8) : [],
    statut: "Brouillon", origine: "e-mail", demandeur: from, receivedAt: now, pending: [], events: [],
    transcript: [{ role: "user", content: emailText }, { role: "assistant", content: String(res.message || "") }],
    echanges: 1, reply,
  };
  addEvent(doc, { at: now, type: "capture", by: "e-mail", text: `E-mail reçu de ${from}${subject ? ` : « ${subject} »` : ""}.` });
  reply.sent = await sendReply({ to: from, subject: reply.subject, text: replyText }).catch(() => false);
  addEvent(doc, { at: now, type: "agent", by: "agent", text: reply.sent ? "Réponse envoyée par e-mail avec les questions de l'agent." : "Réponse préparée (envoi d'e-mail non configuré)." });
  await store().setJSON(id, doc);
  return Response.json({ id, reply, link, titre: doc.titre, score: doc.score });
};

export const config = { path: "/api/inbound-email", method: "POST" };
