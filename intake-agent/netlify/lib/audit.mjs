import { getStore } from "@netlify/blobs";
import { actorOf } from "./session.mjs";

// Append-only audit trail: one object per entry, keyed by day, never rewritten. Retention purges whole days.
const store = () => getStore({ name: "audit", consistency: "strong" });

export async function audit(a, action, { target = null, details = "", req = null } = {}) {
  const now = new Date(), iso = now.toISOString();
  const entry = {
    at: iso, action, actor: actorOf(a),
    target: target ? { id: String(target.id || ""), titre: String(target.titre || "").slice(0, 120) } : null,
    details: String(details || "").slice(0, 600),
    ip: req ? (req.headers.get("x-nf-client-connection-ip") || "") : "",
  };
  try { await store().setJSON(`${iso.slice(0, 10)}/${iso}-${crypto.randomUUID().slice(0, 6)}`, entry); }
  catch (e) { console.error("audit error", e?.message); }
}

const dayKeys = (days) => Array.from({ length: days }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));

export async function listAudit({ days = 30, limit = 400 } = {}) {
  const s = store(), keys = [];
  for (const d of dayKeys(Math.min(366, Math.max(1, days)))) {
    const { blobs } = await s.list({ prefix: d + "/" });
    keys.push(...blobs.map((b) => b.key));
    if (keys.length >= limit) break;
  }
  keys.sort().reverse();
  return (await Promise.all(keys.slice(0, limit).map((k) => s.get(k, { type: "json" })))).filter(Boolean);
}

// Deletes entries older than `months`; returns how many were removed.
export async function purgeAudit(months) {
  const s = store(), limit = new Date(Date.now() - months * 30.4 * 864e5).toISOString().slice(0, 10);
  const { blobs } = await s.list();
  const old = blobs.filter((b) => b.key.slice(0, 10) < limit);
  await Promise.all(old.map((b) => s.delete(b.key)));
  return old.length;
}
