import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

// Web Push for the installable app: each device subscription remembers the fiches it follows.
const store = () => getStore({ name: "push", consistency: "strong" });
const keyOf = (endpoint) => createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 40);
export const pushConfigured = () => !!(Netlify.env.get("VAPID_PUBLIC_KEY") && Netlify.env.get("VAPID_PRIVATE_KEY"));

let wp = null;
async function webpush() {
  if (wp) return wp;
  const mod = await import("web-push");
  wp = mod.default || mod;
  wp.setVapidDetails(Netlify.env.get("VAPID_SUBJECT") || "https://agent-intake-innovation.netlify.app", Netlify.env.get("VAPID_PUBLIC_KEY"), Netlify.env.get("VAPID_PRIVATE_KEY"));
  return wp;
}

export async function saveSubscription(sub, ficheIds) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error("invalid subscription");
  const ids = (Array.isArray(ficheIds) ? ficheIds : []).map(String).slice(0, 100);
  await store().setJSON(keyOf(sub.endpoint), { subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, ficheIds: ids, at: new Date().toISOString() });
}
export const removeSubscription = (endpoint) => store().delete(keyOf(endpoint));

async function sendTo(rec, payload) {
  const w = await webpush();
  try { await w.sendNotification(rec.subscription, JSON.stringify(payload), { TTL: 86400, urgency: "normal" }); return true; }
  catch (e) {
    if (e?.statusCode === 404 || e?.statusCode === 410) await removeSubscription(rec.subscription.endpoint);
    else console.error("push error", e?.statusCode, e?.body || e?.message);
    return false;
  }
}

export async function sendTest(endpoint) {
  if (!pushConfigured()) return false;
  const rec = await store().get(keyOf(endpoint), { type: "json" });
  return rec ? sendTo(rec, { title: "Notifications activées", body: "Vous recevrez ici les questions de l'agent et les réponses de la DSI sur vos besoins.", url: "/?tab=mine", tag: "test" }) : false;
}

// Notifies every device that follows a fiche. Returns how many devices were reached.
export async function pushForFiche(ficheId, payload) {
  if (!pushConfigured()) return 0;
  const s = store();
  const { blobs } = await s.list();
  const recs = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter((r) => r && (r.ficheIds || []).includes(ficheId));
  const sent = await Promise.all(recs.map((r) => sendTo(r, { url: `/?fiche=${ficheId}`, tag: `fiche-${ficheId}`, ...payload })));
  return sent.filter(Boolean).length;
}

// Stops notifications about these fiches (erasure); a device that follows nothing else is forgotten.
export async function removeForFiches(ids) {
  const set = new Set(ids || []); if (!set.size) return 0;
  const s = store();
  const { blobs } = await s.list();
  let n = 0;
  for (const b of blobs) {
    const r = await s.get(b.key, { type: "json" });
    if (!r || !(r.ficheIds || []).some((id) => set.has(id))) continue;
    r.ficheIds = r.ficheIds.filter((id) => !set.has(id)); n++;
    if (r.ficheIds.length) await s.setJSON(b.key, r); else await s.delete(b.key);
  }
  return n;
}
