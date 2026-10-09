import { GoogleGenAI } from "@google/genai";
import { parseLoose } from "./claude.mjs";

// Speech-to-text through the Netlify AI Gateway (GEMINI_API_KEY / GOOGLE_GEMINI_BASE_URL injected at runtime).
// Created on first use, inside a request, for the same reason as the Anthropic client (see claude.mjs).
let ai = null;
const gemini = () => (ai ||= new GoogleGenAI({}));
const PROMPT = `Transcris fidèlement cet enregistrement d'un collaborateur qui décrit un besoin professionnel ou répond à une question sur ce besoin. Il peut parler français, darija marocaine, arabe ou anglais, souvent en les mélangeant. Ne résume pas, ne corrige pas le fond.
Réponds uniquement en JSON : {"langue":"fr|darija|ar|en|mixte","transcription":"texte tel que prononcé","francais":"traduction française fidèle (identique à la transcription si c'est déjà du français)"}`;

export async function transcribeAudio(data, mimeType = "audio/wav") {
  const r = await gemini().models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: mimeType.split(";")[0], data } }, { text: PROMPT }] }],
    config: { responseMimeType: "application/json" },
  });
  const obj = parseLoose(r.text || "");
  if (!obj || typeof obj.transcription !== "string") throw new Error("transcription failed");
  return { langue: obj.langue || "fr", transcription: obj.transcription, francais: obj.francais || obj.transcription };
}
