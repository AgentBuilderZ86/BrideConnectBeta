import { getStore } from "@netlify/blobs";
import { authorized } from "../lib/auth.mjs";

const STATUTS = ["À qualifier", "En qualification", "Qualifié — à instruire", "Réorienté", "Clos"];
const store = () => getStore({ name: "fiches", consistency: "strong" });

export default async (req, context) => {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const s = store();
  const id = context.params?.id;

  if (req.method === "GET" && !id) {
    const { blobs } = await s.list();
    const items = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
    items.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    return Response.json({ items });
  }

  if (req.method === "POST" && !id) {
    const raw = await req.text();
    if (raw.length > 300_000) return Response.json({ error: "too large" }, { status: 413 });
    let doc;
    try { doc = JSON.parse(raw); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
    if (!doc || typeof doc !== "object" || typeof doc.fiche !== "object") return Response.json({ error: "invalid fiche" }, { status: 400 });
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    await s.setJSON(newId, { ...doc, id: newId, statut: "À qualifier", submittedAt: doc.submittedAt || now, receivedAt: now });
    return Response.json({ id: newId });
  }

  if (req.method === "PATCH" && id) {
    const cur = await s.get(id, { type: "json" });
    if (!cur) return Response.json({ error: "not found" }, { status: 404 });
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
    if (!STATUTS.includes(body?.statut)) return Response.json({ error: "invalid statut" }, { status: 400 });
    await s.setJSON(id, { ...cur, statut: body.statut, statutMaj: new Date().toISOString() });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
};

export const config = {
  path: ["/api/fiches", "/api/fiches/:id"],
  method: ["GET", "POST", "PATCH"],
};
