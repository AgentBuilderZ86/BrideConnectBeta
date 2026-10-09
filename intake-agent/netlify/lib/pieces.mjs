import { getStore } from "@netlify/blobs";
import { kindOf, extractText } from "./extract.mjs";

// Attachments (photos, PDF, Excel, Word, PowerPoint, text). The file is kept in the "pieces" store so the DSI
// can open it later; the agent receives it as an image, a PDF document or extracted text.
export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_FILES = 3;
const store = () => getStore({ name: "pieces", consistency: "strong" });
const KIND_LABEL = { image: "Photo", pdf: "PDF", xlsx: "Excel", docx: "Word", pptx: "PowerPoint", text: "Texte" };
const safeName = (n) => String(n || "piece").replace(/[\\/\0<>:"|?*]+/g, "_").slice(0, 120) || "piece";

// Validates and stores incoming files [{name, mime, data (base64)}]. Returns { pieces, blocks, refused }:
// pieces = metadata kept on the fiche, blocks = Messages API content for the agent.
export async function ingest(files, { by = "", canal = "", sub = "" } = {}) {
  const pieces = [], blocks = [], refused = [];
  for (const f of (Array.isArray(files) ? files : []).slice(0, MAX_FILES)) {
    const name = safeName(f?.name);
    const kind = kindOf(name, f?.mime);
    if (!kind || typeof f?.data !== "string") { refused.push(`${name} : format non pris en charge`); continue; }
    const buf = Buffer.from(f.data, "base64");
    if (!buf.length || buf.length > MAX_BYTES) { refused.push(`${name} : fichier vide ou de plus de 4 Mo`); continue; }
    let block, apercu = "";
    try {
      if (kind === "image") {
        const media = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.mime) ? f.mime : "image/jpeg";
        block = { type: "image", source: { type: "base64", media_type: media, data: f.data } };
      } else if (kind === "pdf") {
        block = { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: name };
      } else {
        const text = extractText(kind, buf);
        if (!text.trim()) throw new Error("vide");
        apercu = text.slice(0, 400);
        block = { type: "document", source: { type: "text", media_type: "text/plain", data: text }, title: name };
      }
    } catch { refused.push(`${name} : contenu illisible`); continue; }
    const id = crypto.randomUUID();
    const meta = { id, name, mime: f.mime || "application/octet-stream", kind, label: KIND_LABEL[kind], size: buf.length, at: new Date().toISOString(), by: String(by).slice(0, 120), canal, apercu };
    await store().set(id, buf, { metadata: { name, mime: meta.mime, sub: String(sub || "") } });
    pieces.push(meta);
    blocks.push({ type: "text", text: `Pièce jointe : « ${name} » (${KIND_LABEL[kind]})` }, block);
  }
  return { pieces, blocks, refused };
}

export async function getPiece(id) {
  const r = await store().getWithMetadata(String(id), { type: "arrayBuffer" });
  return r ? { data: Buffer.from(r.data), name: r.metadata?.name || "piece", mime: r.metadata?.mime || "application/octet-stream", sub: r.metadata?.sub || "" } : null;
}
export const deletePiece = (id) => store().delete(String(id));

// Merges what the agent said it took from each file ({nom, retenu}) into the pieces metadata.
export function noteRetenu(pieces, retenus) {
  for (const r of Array.isArray(retenus) ? retenus : []) {
    const p = pieces.find((x) => x.name === r?.nom) || (pieces.length === 1 ? pieces[0] : null);
    if (p && typeof r?.retenu === "string") p.retenu = r.retenu.slice(0, 400);
  }
  return pieces;
}
