import { authorized } from "../lib/auth.mjs";
import { store, QUEUE_STATUTS, applyChanges, addEvent, isoOr, scoreOf } from "../lib/fiche.mjs";

const bad = (msg, status = 400) => Response.json({ error: msg }, { status });
const rid = () => crypto.randomUUID().slice(0, 8);

export default async (req, context) => {
  if (!authorized(req)) return bad("unauthorized", 401);
  const s = store();
  const id = context.params?.id;

  if (req.method === "GET" && !id) {
    const { blobs } = await s.list();
    const items = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
    items.sort((a, b) => String(b.submittedAt || b.receivedAt).localeCompare(String(a.submittedAt || a.receivedAt)));
    return Response.json({ items });
  }

  if (req.method === "GET" && id) {
    const doc = await s.get(id, { type: "json" });
    return doc ? Response.json(doc) : bad("not found", 404);
  }

  if (req.method === "POST" && !id) {
    const raw = await req.text();
    if (raw.length > 300_000) return bad("too large", 413);
    let doc;
    try { doc = JSON.parse(raw); } catch { return bad("invalid json"); }
    if (!doc || typeof doc !== "object" || typeof doc.fiche !== "object") return bad("invalid fiche");
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    const at = isoOr(doc.submittedAt, now);
    const out = { ...doc, id: newId, statut: "À qualifier", submittedAt: at, receivedAt: now, origine: doc.origine || "web", pending: [], events: [] };
    addEvent(out, { at, type: "transmise", by: "métier", text: `Fiche transmise à la DSI après ${doc.echanges || 0} échange(s) avec l'agent.` });
    await s.setJSON(newId, out);
    return Response.json({ id: newId });
  }

  if (req.method === "PATCH" && id) {
    const doc = await s.get(id, { type: "json" });
    if (!doc) return bad("not found", 404);
    let b;
    try { b = await req.json(); } catch { return bad("invalid json"); }
    const at = isoOr(b?.at, new Date().toISOString());
    doc.pending = Array.isArray(doc.pending) ? doc.pending : [];

    switch (b?.op) {
      case "statut": {
        if (!QUEUE_STATUTS.includes(b.statut)) return bad("invalid statut");
        const prev = doc.statut;
        doc.statut = b.statut; doc.statutMaj = at;
        addEvent(doc, { at, type: "statut", by: "DSI", text: `Statut : ${prev || "—"} → ${b.statut}${b.note ? ` (${String(b.note).slice(0, 500)})` : ""}` });
        break;
      }
      case "submit": {
        const d = b.doc || {};
        if (typeof d.fiche !== "object") return bad("invalid fiche");
        Object.assign(doc, {
          titre: d.titre, fiche: d.fiche, score: d.score, pret: d.pret, alertes: d.alertes, transcript: d.transcript,
          echanges: d.echanges, submittedAt: isoOr(d.submittedAt, at), echeance: d.echeance, statut: "À qualifier",
        });
        addEvent(doc, { at, type: "transmise", by: "métier", text: "Brouillon complété avec l'agent et transmis à la DSI." });
        break;
      }
      case "apply": {
        doc.fiche = doc.fiche || {};
        const changed = applyChanges(doc.fiche, b.changes, at, b.source);
        const ids = new Set(Array.isArray(b.pendingIds) ? b.pendingIds : []);
        doc.pending = doc.pending.filter((p) => !ids.has(p.id));
        doc.score = scoreOf(doc.fiche);
        if (b.answeredNudge) doc.nudge = null;
        addEvent(doc, { at, type: "maj", by: b.by || "métier", text: String(b.text || "Fiche mise à jour").slice(0, 1000), fields: changed, source: b.source || "" });
        break;
      }
      case "propose": {
        const props = (Array.isArray(b.proposals) ? b.proposals : []).slice(0, 13).map((p) => ({
          id: rid(), champ: String(p.champ || ""), valeur: p.valeur, statut: "déduit", raison: String(p.raison || "").slice(0, 600),
          source: String(b.source || "observation").slice(0, 120), at,
        })).filter((p) => p.champ);
        if (!props.length) return bad("no proposals");
        doc.pending.push(...props);
        addEvent(doc, { at, type: "observation", by: "agent", text: String(b.text || "Nouvelles informations observées").slice(0, 1000), source: b.source || "" });
        break;
      }
      case "dismiss": {
        const ids = new Set(Array.isArray(b.pendingIds) ? b.pendingIds : []);
        const removed = doc.pending.filter((p) => ids.has(p.id));
        doc.pending = doc.pending.filter((p) => !ids.has(p.id));
        if (removed.length) addEvent(doc, { at, type: "refus", by: "métier", text: `${removed.length} proposition(s) écartée(s) par le porteur.` });
        break;
      }
      case "qualif": {
        if (!b.qualif || typeof b.qualif !== "object") return bad("invalid qualif");
        doc.qualif = { ...b.qualif, at };
        if (doc.statut === "À qualifier") { doc.statut = "En qualification"; doc.statutMaj = at; }
        addEvent(doc, { at, type: "qualif", by: "copilote", text: `Proposition de qualification : Valeur ${b.qualif.valeur?.note ?? "?"}/5, Faisabilité ${b.qualif.faisabilite?.note ?? "?"}/5, trajectoire ${b.qualif.trajectoire?.code || "?"}.` });
        break;
      }
      case "nudge": {
        const n = b.nudge || {};
        if (!n.question) return bad("invalid nudge");
        doc.nudge = { question: String(n.question).slice(0, 600), motif: String(n.motif || "").slice(0, 300), suggestions: (n.suggestions || []).slice(0, 3).map(String), at };
        addEvent(doc, { at, type: "relance", by: "agent", text: `Relance envoyée au porteur : « ${doc.nudge.question} »` });
        break;
      }
      case "reponse": {
        const text = String(b.text || "").trim();
        if (!text) return bad("empty");
        addEvent(doc, { at, type: "reponse", by: "DSI", text: text.slice(0, 4000) });
        break;
      }
      case "note": {
        const text = String(b.text || "").trim();
        if (!text) return bad("empty");
        addEvent(doc, { at, type: "note", by: String(b.by || "DSI").slice(0, 40), text: text.slice(0, 2000) });
        break;
      }
      default:
        return bad("unknown op");
    }
    await s.setJSON(id, doc);
    return Response.json(doc);
  }

  if (req.method === "DELETE" && !id && new URL(req.url).searchParams.get("all") === "1") {
    const { blobs } = await s.list();
    await Promise.all(blobs.map((x) => s.delete(x.key)));
    return Response.json({ deleted: blobs.length });
  }

  return bad("method not allowed", 405);
};

export const config = {
  path: ["/api/fiches", "/api/fiches/:id"],
  method: ["GET", "POST", "PATCH", "DELETE"],
};
