import { guard } from "../lib/session.mjs";
import { transcribeAudio } from "../lib/transcribe.mjs";

export default async (req) => {
  const a = await guard(req, "fiche.create");
  if (a.error) return a.error;
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  const data = body?.audio;
  if (typeof data !== "string" || !data || data.length > 5_500_000) return Response.json({ error: "invalid audio" }, { status: 400 });
  try {
    return Response.json(await transcribeAudio(data, "audio/wav"));
  } catch (e) {
    console.error("transcribe error", e?.status, e?.message);
    return Response.json({ error: "transcription failed" }, { status: 502 });
  }
};

export const config = {
  path: "/api/transcribe",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
