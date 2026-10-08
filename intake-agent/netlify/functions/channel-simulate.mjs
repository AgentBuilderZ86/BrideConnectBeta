import { authorized } from "../lib/auth.mjs";
import { handleIncoming, getConv, deleteConv } from "../lib/channels.mjs";

// Demo phone: runs the exact same conversation logic as the real WhatsApp / Teams adapters,
// without calling the messaging providers.
const CHANNELS = new Set(["whatsapp", "teams"]);
const bad = (m, s = 400) => Response.json({ error: m }, { status: s });
const view = (conv) => ({ messages: conv?.messages || [], ficheId: conv?.ficheId || null, awaiting: conv?.awaiting?.type || null, lastError: conv?.lastError || null });

export default async (req) => {
  if (!authorized(req)) return bad("unauthorized", 401);
  const u = new URL(req.url);
  if (req.method === "GET" || req.method === "DELETE") {
    const channel = u.searchParams.get("channel"), sender = u.searchParams.get("sender");
    if (!CHANNELS.has(channel) || !sender) return bad("channel and sender required");
    if (req.method === "DELETE") { await deleteConv(channel, "sim-" + sender); return Response.json({ ok: true }); }
    return Response.json(view(await getConv(channel, "sim-" + sender)));
  }
  if (req.method !== "POST") return bad("method not allowed", 405);
  let b;
  try { b = await req.json(); } catch { return bad("invalid json"); }
  if (!CHANNELS.has(b?.channel) || !b.sender) return bad("channel and sender required");
  const image = b.image && typeof b.image.data === "string" ? { media_type: b.image.media_type, data: b.image.data } : null;
  const audio = typeof b.audio === "string" && b.audio.length < 5_500_000 ? { data: b.audio, mimeType: "audio/wav", duree: b.duree || null } : null;
  if (!String(b.text || "").trim() && !image && !audio) return bad("empty message");
  const { conv } = await handleIncoming({
    channel: b.channel, sender: "sim-" + String(b.sender).slice(0, 60), name: String(b.name || "").slice(0, 80),
    text: String(b.text || "").slice(0, 8000), image, audio, simulated: true,
  });
  return Response.json(view(conv));
};

export const config = {
  path: "/api/channel/simulate",
  method: ["GET", "POST", "DELETE"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
