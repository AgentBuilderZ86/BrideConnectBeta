import { authorized } from "../lib/auth.mjs";
import { saveSubscription, removeSubscription, sendTest, pushConfigured } from "../lib/push.mjs";

const bad = (m, s = 400) => Response.json({ error: m }, { status: s });

export default async (req) => {
  if (!authorized(req)) return bad("unauthorized", 401);
  if (req.method === "GET") return Response.json({ enabled: pushConfigured(), publicKey: Netlify.env.get("VAPID_PUBLIC_KEY") || null });
  let b;
  try { b = await req.json(); } catch { return bad("invalid json"); }
  if (req.method === "DELETE") { if (b?.endpoint) await removeSubscription(b.endpoint); return Response.json({ ok: true }); }
  if (!pushConfigured()) return bad("push not configured", 503);
  try { await saveSubscription(b?.subscription, b?.ficheIds); } catch { return bad("invalid subscription"); }
  const tested = b?.test ? await sendTest(b.subscription.endpoint) : null;
  return Response.json({ ok: true, tested });
};

export const config = { path: "/api/push", method: ["GET", "POST", "DELETE"] };
