import { inflateRawSync } from "node:zlib";

// Text extraction for Office files (xlsx, docx, pptx are zip archives of XML), without dependencies.
const MAX_ENTRY = 40 * 1024 * 1024;
export const MAX_TEXT = 60_000;

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("archive illisible");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    entries.set(buf.toString("utf8", p + 46, p + 46 + nlen), { method, csize, usize, lho });
    p += 46 + nlen + xlen + clen;
  }
  const read = (name) => {
    const e = entries.get(name);
    if (!e || e.usize > MAX_ENTRY) return null;
    const start = e.lho + 30 + buf.readUInt16LE(e.lho + 26) + buf.readUInt16LE(e.lho + 28);
    const raw = buf.subarray(start, start + e.csize);
    if (e.method === 0) return raw.toString("utf8");
    if (e.method === 8) return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY }).toString("utf8");
    return null;
  };
  return { names: [...entries.keys()], read };
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
const texts = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => decode(m[1]));
const colIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref || ""); let n = 0; for (const c of m ? m[1] : "A") n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

function xlsx(z) {
  const shared = (z.read("xl/sharedStrings.xml") || "").split("</si>").slice(0, -1).map((si) => texts(si, "t").join(""));
  const wb = z.read("xl/workbook.xml") || "";
  const rels = z.read("xl/_rels/workbook.xml.rels") || "";
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1], t = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target[id] = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
  }
  // Cells styled with a date format are converted from Excel serial numbers to dd/mm/yyyy.
  const styles = z.read("xl/styles.xml") || "";
  const custom = {};
  for (const m of styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom[m[1]] = decode(m[2]);
  const xfs = (/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] || "").match(/<xf\b[^>]*>/g) || [];
  const isDateFmt = (id) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom[id] && /[dmy]/i.test(custom[id].replace(/"[^"]*"|\[[^\]]*\]/g, "")) && !/0\.0|#/.test(custom[id]));
  const dateStyle = xfs.map((x) => isDateFmt(Number(/numFmtId="(\d+)"/.exec(x)?.[1] || 0)));
  const asDate = (v) => { const n = Number(v); if (!Number.isFinite(n) || n < 1 || n > 2_958_465) return v; const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 864e5)); return d.toISOString().slice(0, 10).split("-").reverse().join("/") + (n % 1 ? " " + d.toISOString().slice(11, 16) : ""); };
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: decode(/name="([^"]*)"/.exec(m[0])?.[1] || "Feuille"), rid: /r:id="([^"]+)"/.exec(m[0])?.[1] }));
  const out = [];
  for (const sh of sheets) {
    const xml = z.read(target[sh.rid] || "");
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] || "";
        const t = /\bt="([^"]+)"/.exec(attrs)?.[1], i = colIndex(/\br="([^"]+)"/.exec(attrs)?.[1]);
        let v = texts(body, "v")[0] ?? "";
        if (v === "" && /<f[\s>]/.test(body)) v = "=" + (texts(body, "f")[0] || "");
        if (t === "s") v = shared[+v] ?? "";
        else if (t === "inlineStr") v = texts(body, "t").join("");
        else if (t === "b") v = v === "1" ? "VRAI" : "FAUX";
        else if (!t || t === "n") { const st = /\bs="(\d+)"/.exec(attrs)?.[1]; if (st && dateStyle[+st]) v = asDate(v); }
        if (i < 40) cells[i] = String(v).replace(/[\t\n\r]+/g, " ").trim();
      }
      if (cells.some(Boolean)) rows.push(Array.from(cells, (x) => x || "").join("\t"));
      if (rows.length >= 400) { rows.push("(… lignes suivantes non lues)"); break; }
    }
    out.push(`### Onglet « ${sh.name} » (${rows.length} ligne${rows.length > 1 ? "s" : ""})\n${rows.join("\n")}`);
  }
  return `Classeur Excel. Colonnes séparées par des tabulations ; formules remplacées par leur dernière valeur calculée.\n\n${out.join("\n\n")}`;
}

function docx(z) {
  const xml = z.read("word/document.xml") || "";
  return decode(xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>\s*<\/w:tc>/g, " | ").replace(/<\/w:tr>/g, "\n").replace(/<\/w:tc>/g, " | ").replace(/<\/w:p>/g, "\n").replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
}

function pptx(z) {
  const slides = z.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  return slides.map((n, i) => {
    const xml = z.read(n) || "";
    const t = xml.split("</a:p>").map((p) => texts(p, "a:t").join("")).filter((x) => x.trim()).join("\n");
    return `### Diapositive ${i + 1}\n${t}`;
  }).join("\n\n");
}

export const KINDS = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  pdf: ["application/pdf"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel.sheet.macroEnabled.12"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  text: ["text/plain", "text/csv", "text/markdown", "application/json"],
};
const EXT = { jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image", pdf: "pdf", xlsx: "xlsx", xlsm: "xlsx", docx: "docx", pptx: "pptx", txt: "text", csv: "text", md: "text", json: "text" };

export function kindOf(name, mime) {
  const m = String(mime || "").split(";")[0].trim().toLowerCase();
  for (const [k, list] of Object.entries(KINDS)) if (list.includes(m)) return k;
  return EXT[String(name || "").split(".").pop().toLowerCase()] || null;
}

// Returns the text of an Office / text file, truncated to MAX_TEXT characters.
export function extractText(kind, buf) {
  let t;
  if (kind === "text") t = buf.toString("utf8");
  else {
    const z = unzip(buf);
    t = kind === "xlsx" ? xlsx(z) : kind === "docx" ? docx(z) : kind === "pptx" ? pptx(z) : "";
  }
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + "\n(… texte tronqué)" : t;
}
