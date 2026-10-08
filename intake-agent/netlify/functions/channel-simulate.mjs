import { guard } from "../lib/session.mjs";
import { handleIncoming, getConv, deleteConv } from "../lib/channels.mjs";
import { triggerBg } from "../lib/bg.mjs";

// Demo phone: runs the exact same conversation logic as the real WhatsApp / Teams adapters,
// without calling the messaging providers.
const CHANNELS = new Set(["whatsapp", "teams"]);
const bad = (m, s = 400) => Response.json({ error: m }, { status: s });
const view = (conv) => ({ messages: conv?.messages || [], ficheId: conv?.ficheId || null, awaiting: conv?.awaiting?.type || null, lastError: conv?.lastError || null });

export default async (req) => {
  const a = await guard(req, "fiche.create");
  if (a.error) return a.error;
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
  const files = (Array.isArray(b.files) ? b.files : []).filter((f) => f && typeof f.data === "string").slice(0, 3).map((f) => ({ name: String(f.name || "fichier").slice(0, 120), mime: String(f.mime || ""), data: f.data }));
  const audio = typeof b.audio === "string" && b.audio.length < 5_500_000 ? { data: b.audio, mimeType: "audio/wav", duree: b.duree || null } : null;
  if (!String(b.text || "").trim() && !image && !audio && !files.length) return bad("empty message");
  const { conv, submitted } = await handleIncoming({
    channel: b.channel, sender: "sim-" + String(b.sender).slice(0, 60), name: String(b.name || "").slice(0, 80),
    text: String(b.text || "").slice(0, 8000), image, audio, files, simulated: true,
  });
  if (submitted) await triggerBg(u.origin, "/api/synergies-bg", { match: submitted });
  return Response.json(view(conv));
};

export const config = {
  path: "/api/channel/simulate",
  method: ["GET", "POST", "DELETE"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
