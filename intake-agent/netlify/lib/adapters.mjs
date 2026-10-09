import { createHmac, timingSafeEqual } from "node:crypto";

// ---------- WhatsApp Business (Meta Cloud API) ----------
const env = (k) => Netlify.env.get(k);
const graph = () => `https://graph.facebook.com/${env("WHATSAPP_GRAPH_VERSION") || "v23.0"}`;
export const waConfigured = () => !!(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID"));

export function verifyWhatsAppSignature(rawBody, header) {
  const secret = env("WHATSAPP_APP_SECRET");
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex"));
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Sends a reply. Quick replies become interactive buttons (max 3, 20 characters). Outside the 24-hour
// customer-service window WhatsApp only accepts approved templates: pass { template } for those messages.
export async function sendWhatsApp(to, text, quick = [], { template } = {}) {
  if (!waConfigured()) return false;
  let body;
  if (template) {
    body = { messaging_product: "whatsapp", to, type: "template", template: { name: template, language: { code: env("WHATSAPP_TEMPLATE_LANG") || "fr" }, components: [{ type: "body", parameters: [{ type: "text", text: text.slice(0, 1000) }] }] } };
  } else if (quick.length && text.length <= 1024) {
    body = { messaging_product: "whatsapp", to, type: "interactive", interactive: { type: "button", body: { text }, action: { buttons: quick.slice(0, 3).map((q, i) => ({ type: "reply", reply: { id: `q${i}`, title: q.slice(0, 20) } })) } } };
  } else {
    body = { messaging_product: "whatsapp", to, type: "text", text: { body: text.slice(0, 4096) } };
  }
  const r = await fetch(`${graph()}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST", headers: { authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) console.error("whatsapp send error", r.status, await r.text());
  return r.ok;
}

export async function fetchWhatsAppMedia(id) {
  const auth = { authorization: `Bearer ${env("WHATSAPP_TOKEN")}` };
  const meta = await (await fetch(`${graph()}/${id}`, { headers: auth })).json();
  if (!meta?.url) throw new Error("media url missing");
  const bytes = Buffer.from(await (await fetch(meta.url, { headers: auth })).arrayBuffer());
  return { data: bytes.toString("base64"), mimeType: meta.mime_type || "application/octet-stream" };
}

// ---------- Microsoft Teams (Azure Bot / Bot Framework) ----------
export const teamsConfigured = () => !!(env("TEAMS_APP_ID") && env("TEAMS_APP_PASSWORD"));
let jwks = null;
let botToken = { value: null, exp: 0 };

// Validates the Bot Framework bearer token sent with every activity.
export async function verifyTeamsRequest(req, activity) {
  const appId = env("TEAMS_APP_ID");
  const auth = req.headers.get("authorization") || "";
  if (!appId || !auth.startsWith("Bearer ")) return false;
  try {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    if (!jwks) {
      const cfg = await (await fetch("https://login.botframework.com/v1/.well-known/openidconfiguration")).json();
      jwks = createRemoteJWKSet(new URL(cfg.jwks_uri));
    }
    const { payload } = await jwtVerify(auth.slice(7), jwks, { issuer: "https://api.botframework.com", audience: appId });
    return !payload.serviceurl || payload.serviceurl === activity?.serviceUrl;
  } catch (e) {
    console.error("teams auth failed", e?.message);
    return false;
  }
}

async function getBotToken() {
  if (botToken.value && Date.now() < botToken.exp) return botToken.value;
  const tenant = env("TEAMS_TENANT_ID") || "botframework.com";
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env("TEAMS_APP_ID"), client_secret: env("TEAMS_APP_PASSWORD"), scope: "https://api.botframework.com/.default" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("bot token failed");
  botToken = { value: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return botToken.value;
}

// Downloads a file sent to the bot: Teams file cards carry a pre-authorised download URL; inline images
// need the bot token. Returns {name, mime, data} or null.
export async function fetchTeamsAttachment(att) {
  try {
    if (att?.contentType === "application/vnd.microsoft.teams.file.download.info" && att.content?.downloadUrl) {
      const r = await fetch(att.content.downloadUrl);
      const ext = String(att.content.fileType || "").toLowerCase();
      return r.ok ? { name: att.name || `fichier.${ext}`, mime: r.headers.get("content-type") || "", data: Buffer.from(await r.arrayBuffer()).toString("base64") } : null;
    }
    if (/^image\//.test(att?.contentType || "") && att.contentUrl) {
      const r = await fetch(att.contentUrl, { headers: { authorization: `Bearer ${await getBotToken()}` } });
      return r.ok ? { name: att.name || "image.png", mime: att.contentType, data: Buffer.from(await r.arrayBuffer()).toString("base64") } : null;
    }
  } catch (e) { console.error("teams attachment", e?.message); }
  return null;
}

// Sends a message into a stored Teams conversation (works for replies and proactive nudges).
export async function sendTeams(ref, text, quick = []) {
  if (!teamsConfigured() || !ref?.serviceUrl || !ref?.conversationId) return false;
  const body = { type: "message", text, textFormat: "plain" };
  if (quick.length) body.attachments = [{ contentType: "application/vnd.microsoft.card.hero", content: { buttons: quick.slice(0, 3).map((q) => ({ type: "imBack", title: q, value: q })) } }];
  const r = await fetch(`${ref.serviceUrl.replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(ref.conversationId)}/activities`, {
    method: "POST", headers: { authorization: `Bearer ${await getBotToken()}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) console.error("teams send error", r.status, await r.text());
  return r.ok;
}

// ---------- E-mail (Resend) ----------
export async function sendEmail({ to, subject, text }) {
  const key = env("RESEND_API_KEY"), from = env("RESEND_FROM");
  if (!key || !from || !to) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, text }),
  });
  if (!r.ok) console.error("resend error", r.status, await r.text());
  return r.ok;
}
