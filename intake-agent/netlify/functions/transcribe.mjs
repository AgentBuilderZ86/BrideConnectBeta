import { GoogleGenAI } from "@google/genai";
import { authorized } from "../lib/auth.mjs";
import { parseLoose } from "../lib/claude.mjs";

// Speech-to-text through the Netlify AI Gateway (GEMINI_API_KEY / GOOGLE_GEMINI_BASE_URL injected at runtime).
const ai = new GoogleGenAI({});
const PROMPT = `Transcris fidèlement cet enregistrement d'un collaborateur qui décrit un besoin professionnel. Il peut parler français, darija marocaine, arabe ou anglais, souvent en les mélangeant. Ne résume pas, ne corrige pas le fond.
Réponds uniquement en JSON : {"langue":"fr|darija|ar|en|mixte","transcription":"texte tel que prononcé","francais":"traduction française fidèle (identique à la transcription si c'est déjà du français)"}`;

export default async (req) => {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  const data = body?.audio;
  if (typeof data !== "string" || !data || data.length > 5_500_000) return Response.json({ error: "invalid audio" }, { status: 400 });
  try {
    const r = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data } }, { text: PROMPT }] }],
      config: { responseMimeType: "application/json" },
    });
    const obj = parseLoose(r.text || "");
    if (!obj || typeof obj.transcription !== "string") return Response.json({ error: "transcription failed" }, { status: 502 });
    return Response.json({ langue: obj.langue || "fr", transcription: obj.transcription, francais: obj.francais || obj.transcription });
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
