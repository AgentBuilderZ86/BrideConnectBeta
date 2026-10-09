import { handleIncoming, sendReplies } from "../lib/channels.mjs";
import { verifyWhatsAppSignature, fetchWhatsAppMedia } from "../lib/adapters.mjs";
import { triggerBg } from "../lib/bg.mjs";

// WhatsApp Business Cloud API webhook. Configure in the Meta app: callback URL
// https://<site>/api/channel/whatsapp, verify token = WHATSAPP_VERIFY_TOKEN, subscribe to "messages".
// Requires WHATSAPP_APP_SECRET (signature check), WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID.
async function processMessage(value, msg, origin) {
  const name = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name || "";
  let text = "", audio = null;
  const files = [];
  if (msg.type === "text") text = msg.text?.body || "";
  else if (msg.type === "interactive") text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
  else if (msg.type === "button") text = msg.button?.text || "";
  else if (msg.type === "audio") { const m = await fetchWhatsAppMedia(msg.audio.id); audio = { data: m.data, mimeType: m.mimeType }; }
  else if (msg.type === "image" || msg.type === "document") {
    const media = msg[msg.type];
    const m = await fetchWhatsAppMedia(media.id);
    const mime = m.mimeType.split(";")[0];
    files.push({ name: media.filename || (msg.type === "image" ? "photo.jpg" : "document"), mime, data: m.data });
    text = media.caption || "";
  } else return;
  const { conv, replies, submitted } = await handleIncoming({ channel: "whatsapp", sender: msg.from, name, text, audio, files });
  await sendReplies(conv, replies);
  if (submitted) await triggerBg(origin, "/api/synergies-bg", { match: submitted });
}

export default async (req, context) => {
  const u = new URL(req.url);
  if (req.method === "GET") {
    const ok = u.searchParams.get("hub.mode") === "subscribe" && !!Netlify.env.get("WHATSAPP_VERIFY_TOKEN") && u.searchParams.get("hub.verify_token") === Netlify.env.get("WHATSAPP_VERIFY_TOKEN");
    return ok ? new Response(u.searchParams.get("hub.challenge") || "") : new Response("forbidden", { status: 403 });
  }
  const raw = await req.text();
  if (!verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("forbidden", { status: 403 });
  let body;
  try { body = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }
  const jobs = [];
  for (const entry of body.entry || []) for (const ch of entry.changes || []) {
    const value = ch.value || {};
    for (const msg of value.messages || []) jobs.push(processMessage(value, msg, u.origin).catch((e) => console.error("whatsapp message error", e?.message)));
  }
  // Acknowledge immediately (Meta retries slow webhooks); the agent answers in the background.
  context.waitUntil(Promise.all(jobs));
  return new Response("ok");
};

export const config = { path: "/api/channel/whatsapp", method: ["GET", "POST"] };
