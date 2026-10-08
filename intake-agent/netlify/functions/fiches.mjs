import { getStore } from "@netlify/blobs";
import { guard, can, canActAsOwner, canSeeFiche } from "../lib/session.mjs";
import { store, listFiches, QUEUE_STATUTS, FIELD_KEYS, applyChanges, applyMesures, addEvent, isoOr, scoreOf } from "../lib/fiche.mjs";
import { deliverNudge, informOwner } from "../lib/channels.mjs";
import { pushForFiche } from "../lib/push.mjs";
import { audit } from "../lib/audit.mjs";
import { triggerBg } from "../lib/bg.mjs";

const bad = (msg, status = 400) => Response.json({ error: msg }, { status });
const rid = () => crypto.randomUUID().slice(0, 8);
// Actions of the person who expressed the need, and actions reserved to the DSI.
const OWNER_OPS = new Set(["submit", "apply", "dismiss"]);
const DSI_OPS = new Set(["statut", "propose", "qualif", "nudge", "valeur_def", "mesure", "reponse", "fusion", "relation", "proche_ecarte", "story"]);
const STORY_STATUTS = ["À faire", "En cours", "Fait"];
const short = (s, n = 60) => String(s || "votre besoin").slice(0, n);

// Attachment metadata sent by the page at submission (the files themselves are already stored).
const cleanPieces = (list) => (Array.isArray(list) ? list : []).slice(0, 12).filter((p) => p && typeof p.id === "string" && /^[0-9a-f-]{36}$/.test(p.id)).map((p) => ({
  id: p.id, name: String(p.name || "piece").slice(0, 120), mime: String(p.mime || "").slice(0, 120), kind: String(p.kind || "").slice(0, 10), label: String(p.label || "").slice(0, 20),
  size: Number(p.size) || 0, at: isoOr(p.at, new Date().toISOString()), by: String(p.by || "").slice(0, 120), canal: String(p.canal || "web").slice(0, 20),
  apercu: String(p.apercu || "").slice(0, 400), retenu: String(p.retenu || "").slice(0, 400),
}));

export default async (req, context) => {
  let a = await guard(req, "fiche.create");
  if (a.error) return a.error;
  const s = store();
  const id = context.params?.id;
  const origin = new URL(req.url).origin;

  if (req.method === "GET" && !id) {
    let items = await listFiches();
    // Without the right to read every fiche (Métier role), a person sees only their own.
    if (!can(a.role, "fiche.read")) items = items.filter((d) => canSeeFiche(d, a));
    items.sort((x, y) => String(y.submittedAt || y.receivedAt).localeCompare(String(x.submittedAt || x.receivedAt)));
    return Response.json({ items });
  }

  if (req.method === "GET" && id) {
    const doc = await s.get(id, { type: "json" });
    if (!doc) return bad("not found", 404);
    // A fiche without owner (e-mail link, demo data) is readable by whoever holds its id.
    if (!canSeeFiche(doc, a) && doc.owner) return bad("forbidden", 403);
    return Response.json(doc);
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
    const sess = a.session;
    const out = {
      ...doc, id: newId, statut: "À qualifier", submittedAt: at, receivedAt: now, origine: doc.origine || "web", pending: [], events: [],
      pieces: cleanPieces(doc.pieces),
      owner: sess ? { sub: sess.sub, name: sess.name, email: sess.email || "" } : null,
      demandeur: sess ? (sess.email || sess.name) : (doc.demandeur || null),
      consentement: doc.consentement && typeof doc.consentement === "object" ? { at: isoOr(doc.consentement.at, now), version: String(doc.consentement.version || "").slice(0, 20), canal: "web" } : null,
    };
    for (const k of ["proches", "cadrage", "coporteurs", "fusionnes", "qualif", "valeur", "nudge"]) delete out[k];
    addEvent(out, { at, type: "transmise", by: "métier", text: `Fiche transmise à la DSI après ${doc.echanges || 0} échange(s) avec l'agent${out.pieces.length ? ` et ${out.pieces.length} pièce(s) jointe(s)` : ""}.` });
    await s.setJSON(newId, out);
    await audit(a, "fiche transmise", { target: out, req });
    await triggerBg(origin, "/api/synergies-bg", { match: newId });
    return Response.json({ id: newId });
  }

  if (req.method === "PATCH" && id) {
    const doc = await s.get(id, { type: "json" });
    if (!doc) return bad("not found", 404);
    let b;
    try { b = await req.json(); } catch { return bad("invalid json"); }
    const op = b?.op;
    if (OWNER_OPS.has(op) && !canActAsOwner(doc, a)) return bad("forbidden", 403);
    if (DSI_OPS.has(op) && (a = await guard(req, "fiche.dsi")).error) return a.error;
    if (op === "note" && !canActAsOwner(doc, a) && !can(a.role, "fiche.dsi")) return bad("forbidden", 403);
    const at = isoOr(b?.at, new Date().toISOString());
    doc.pending = Array.isArray(doc.pending) ? doc.pending : [];
    let auditText = "";

    switch (op) {
      case "statut": {
        if (!QUEUE_STATUTS.includes(b.statut) || b.statut === "Fusionné") return bad("invalid statut");
        const prev = doc.statut;
        doc.statut = b.statut; doc.statutMaj = at;
        if (b.statut === "En production" && !doc.productionAt) doc.productionAt = at;
        if (b.statut === "En réalisation" && !doc.realisationAt) doc.realisationAt = at;
        addEvent(doc, { at, type: "statut", by: "DSI", text: `Statut : ${prev || "—"} → ${b.statut}${b.note ? ` (${String(b.note).slice(0, 500)})` : ""}` });
        if (prev !== b.statut) await pushForFiche(id, { title: `« ${short(doc.titre)} »`, body: `Nouveau statut : ${b.statut}` }).catch(() => 0);
        auditText = `${prev || "—"} → ${b.statut}`;
        break;
      }
      case "submit": {
        const d = b.doc || {};
        if (typeof d.fiche !== "object") return bad("invalid fiche");
        Object.assign(doc, {
          titre: d.titre, fiche: d.fiche, score: d.score, pret: d.pret, alertes: d.alertes, transcript: d.transcript,
          echanges: d.echanges, submittedAt: isoOr(d.submittedAt, at), echeance: d.echeance, statut: "À qualifier",
        });
        const extra = cleanPieces(d.pieces).filter((p) => !(doc.pieces || []).some((x) => x.id === p.id));
        doc.pieces = [...(doc.pieces || []), ...extra];
        if (a.session && !doc.owner) doc.owner = { sub: a.session.sub, name: a.session.name, email: a.session.email || "" };
        if (d.consentement) doc.consentement = { at: isoOr(d.consentement.at, at), version: String(d.consentement.version || "").slice(0, 20), canal: "web" };
        addEvent(doc, { at, type: "transmise", by: "métier", text: "Brouillon complété avec l'agent et transmis à la DSI." });
        auditText = "brouillon transmis";
        break;
      }
      case "apply": {
        doc.fiche = doc.fiche || {};
        const changed = applyChanges(doc.fiche, b.changes, at, b.source);
        const ids = new Set(Array.isArray(b.pendingIds) ? b.pendingIds : []);
        doc.pending = doc.pending.filter((p) => !ids.has(p.id));
        const nm = applyMesures(doc, b.mesures, at, b.source || "métier");
        doc.score = scoreOf(doc.fiche);
        if (b.answeredNudge) doc.nudge = null;
        addEvent(doc, { at, type: "maj", by: b.by || "métier", text: String(b.text || "Fiche mise à jour").slice(0, 1000) + (nm ? ` (${nm} mesure${nm > 1 ? "s" : ""} de valeur)` : ""), fields: changed, source: b.source || "" });
        auditText = changed.length ? `champs : ${changed.join(", ")}` : "mise à jour";
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
        auditText = `V${b.qualif.valeur?.note ?? "?"} F${b.qualif.faisabilite?.note ?? "?"} ${b.qualif.trajectoire?.code || ""}`;
        break;
      }
      case "nudge": {
        const n = b.nudge || {};
        if (!n.question) return bad("invalid nudge");
        doc.nudge = { question: String(n.question).slice(0, 600), motif: String(n.motif || "").slice(0, 300), suggestions: (n.suggestions || []).slice(0, 3).map(String), at };
        const via = await deliverNudge(doc, doc.nudge).catch(() => "application");
        addEvent(doc, { at, type: "relance", by: "agent", text: `Relance envoyée au porteur (${via}) : « ${doc.nudge.question} »` });
        break;
      }
      case "valeur_def": {
        const inds = (Array.isArray(b.indicateurs) ? b.indicateurs : []).slice(0, 5).map((i, n) => ({
          id: "k" + (n + 1), nom: String(i.nom || "").slice(0, 160), unite: String(i.unite || "").slice(0, 40),
          avant: i.avant === null || i.avant === undefined || i.avant === "null" ? null : String(i.avant).slice(0, 80),
          cible: i.cible === null || i.cible === undefined || i.cible === "null" ? null : String(i.cible).slice(0, 80),
          comment_mesurer: String(i.comment_mesurer || "").slice(0, 300),
        })).filter((i) => i.nom);
        if (!inds.length) return bad("no indicators");
        doc.valeur = { indicateurs: inds, mesures: doc.valeur?.mesures || [], definedAt: at };
        addEvent(doc, { at, type: "valeur", by: "DSI", text: `Indicateurs de valeur définis : ${inds.map((i) => i.nom).join(" ; ")}.` });
        break;
      }
      case "mesure": {
        const nm = applyMesures(doc, b.mesures, at, String(b.source || "DSI").slice(0, 60));
        if (!nm) return bad("no valid measure");
        addEvent(doc, { at, type: "valeur", by: String(b.by || "DSI").slice(0, 40), text: `${nm} mesure${nm > 1 ? "s" : ""} de valeur enregistrée${nm > 1 ? "s" : ""}.` });
        break;
      }
      case "reponse": {
        const text = String(b.text || "").trim();
        if (!text) return bad("empty");
        addEvent(doc, { at, type: "reponse", by: "DSI", text: text.slice(0, 4000) });
        await pushForFiche(id, { title: `Réponse de la DSI sur « ${short(doc.titre)} »`, body: text.slice(0, 180) }).catch(() => 0);
        break;
      }
      case "note": {
        const text = String(b.text || "").trim();
        if (!text) return bad("empty");
        addEvent(doc, { at, type: "note", by: String(b.by || "DSI").slice(0, 40), text: text.slice(0, 2000) });
        break;
      }
      // Duplicates merged into this fiche: the DSI validated the merged values proposed by the agent.
      case "fusion": {
        const srcIds = (Array.isArray(b.sources) ? b.sources : []).map(String).filter((x) => x !== id).slice(0, 8);
        const srcs = (await Promise.all(srcIds.map((x) => s.get(x, { type: "json" })))).filter((d) => d && d.statut !== "Fusionné");
        if (!srcs.length) return bad("no source");
        doc.fiche = doc.fiche || {};
        const changes = Object.fromEntries((Array.isArray(b.propositions) ? b.propositions : []).filter((p) => p && FIELD_KEYS.includes(p.champ)).map((p) => [p.champ, { valeur: p.valeur, statut: p.statut === "déclaré" ? "déclaré" : "déduit", note: p.raison }]));
        const changed = applyChanges(doc.fiche, changes, at, "fusion", { protectConfirmed: true });
        if (typeof b.titre === "string" && b.titre.trim()) doc.titre = b.titre.trim().slice(0, 80);
        doc.coporteurs = [...(doc.coporteurs || []), ...srcs.map((d) => ({ ficheId: d.id, titre: d.titre, demandeur: d.owner?.name || d.contact?.name || d.demandeur || "", direction: d.fiche?.direction?.valeur || "", canal: d.origine || "web", owner: d.owner ? { sub: d.owner.sub, email: d.owner.email || "" } : null, at }))];
        doc.fusionnes = [...(doc.fusionnes || []), ...srcs.map((d) => d.id)];
        doc.pieces = [...(doc.pieces || []), ...srcs.flatMap((d) => d.pieces || [])];
        doc.proches = (doc.proches || []).filter((p) => !srcIds.includes(p.id));
        doc.score = scoreOf(doc.fiche);
        addEvent(doc, { at, type: "synergie", by: "DSI", text: `Fusion : ${srcs.map((d) => `« ${d.titre} »`).join(", ")} rejoint ce besoin, désormais porté conjointement. ${String(b.resume || "").slice(0, 400)}`, fields: changed });
        for (const d of srcs) {
          Object.assign(d, { statut: "Fusionné", statutMaj: at, fusionneDans: id, nudge: null });
          addEvent(d, { at, type: "synergie", by: "DSI", text: `Besoin fusionné dans « ${doc.titre} », qui réunit les demandes identiques. Le suivi continue sur cette fiche commune.` });
          await s.setJSON(d.id, d);
          await informOwner(d, { title: `Votre besoin « ${short(d.titre)} »`, text: `La DSI a regroupé votre besoin avec une demande identique : « ${doc.titre} ». Vous en êtes co-porteur ; le suivi continue sur cette fiche commune.`, url: `/?fiche=${id}` }).catch(() => 0);
          await audit(a, "fiche fusionnée", { target: d, details: `dans « ${doc.titre} »`, req });
        }
        await informOwner(doc, { title: `Votre besoin « ${short(doc.titre)} »`, text: `La DSI a regroupé votre besoin avec ${srcs.length} demande(s) identique(s) d'autres équipes : il est désormais porté conjointement.` }).catch(() => 0);
        auditText = `${srcs.length} fiche(s) fusionnée(s)`;
        break;
      }
      // Puts the owners of two related needs in touch.
      case "relation": {
        const other = await s.get(String(b.with || ""), { type: "json" });
        if (!other || other.id === id) return bad("invalid fiche");
        const msg = String(b.message || "").trim().slice(0, 800);
        const who = (d) => [d.owner?.name || d.contact?.name || d.demandeur, d.fiche?.direction?.valeur].filter(Boolean).join(", ") || "un autre demandeur";
        for (const [x, y] of [[doc, other], [other, doc]]) {
          x.relations = [...(x.relations || []).filter((r) => r.id !== y.id), { id: y.id, titre: y.titre, avec: who(y), at }];
          x.proches = (x.proches || []).filter((p) => p.id !== y.id);
          addEvent(x, { at, type: "synergie", by: "DSI", text: `Mise en relation avec ${who(y)} au sujet de « ${y.titre} ».${msg ? " " + msg : ""}` });
        }
        await s.setJSON(other.id, other);
        await informOwner(doc, { title: "Mise en relation", text: `${msg || "Un besoin proche du vôtre existe ailleurs dans le Groupe."} Contact : ${who(other)} (« ${other.titre} »).` }).catch(() => 0);
        await informOwner(other, { title: "Mise en relation", text: `${msg || "Un besoin proche du vôtre existe ailleurs dans le Groupe."} Contact : ${who(doc)} (« ${doc.titre} »).`, url: `/?fiche=${other.id}` }).catch(() => 0);
        auditText = `avec « ${other.titre} »`;
        break;
      }
      case "proche_ecarte": {
        doc.proches = (doc.proches || []).filter((p) => p.id !== b.with);
        break;
      }
      case "story": {
        const st = (doc.cadrage?.user_stories || []).find((x) => x.id === b.sid);
        if (!st || !STORY_STATUTS.includes(b.statut)) return bad("invalid story");
        const prev = st.statut || "À faire";
        if (prev === b.statut) break;
        st.statut = b.statut; st.maj = at;
        const all = doc.cadrage.user_stories, done = all.filter((x) => x.statut === "Fait");
        const pts = (l) => l.reduce((n, x) => n + (Number(x.points) || 0), 0);
        doc.cadrage.avancement = { faites: done.length, total: all.length, pct: pts(all) ? Math.round(100 * pts(done) / pts(all)) : Math.round(100 * done.length / all.length) };
        addEvent(doc, { at, type: "livraison", by: "DSI", text: `${st.id} « je veux ${st.je_veux} » : ${prev} → ${b.statut} (avancement ${doc.cadrage.avancement.pct} %, ${done.length}/${all.length} stories).` });
        if (b.statut === "Fait") await informOwner(doc, { title: `Avancement de « ${short(doc.titre)} »`, text: `Livré : ${st.en_tant_que ? `en tant que ${st.en_tant_que}, ` : ""}vous pouvez désormais ${st.je_veux}. Avancement du projet : ${doc.cadrage.avancement.pct} %.`, quiet: true }).catch(() => 0);
        auditText = `${st.id} → ${b.statut}`;
        break;
      }
      default:
        return bad("unknown op");
    }
    await s.setJSON(id, doc);
    if (op !== "note" && op !== "proche_ecarte") await audit(a, `fiche : ${op}`, { target: doc, details: auditText, req });
    if (op === "submit") await triggerBg(origin, "/api/synergies-bg", { match: id });
    return Response.json(doc);
  }

  if (req.method === "DELETE" && !id && new URL(req.url).searchParams.get("all") === "1") {
    if ((a = await guard(req, "demo.reset")).error) return a.error;
    const { blobs } = await s.list();
    await Promise.all(blobs.map((x) => s.delete(x.key)));
    // A demo reset also clears conversations, attachments and the autopilot history.
    for (const name of ["conversations", "pieces"]) {
      const st = getStore({ name, consistency: "strong" });
      const { blobs: bl } = await st.list();
      await Promise.all(bl.map((x) => st.delete(x.key)));
    }
    const pilot = getStore({ name: "pilot", consistency: "strong" });
    await Promise.all(["runs", "digests", "running", "portfolio", "portfolio-history", "portfolio-running", "portfolio-error", "synergies", "synergies-running", "synergies-error"].map((k) => pilot.delete(k)));
    await audit(a, "remise à zéro de la démo", { details: `${blobs.length} fiche(s) supprimée(s)`, req });
    return Response.json({ deleted: blobs.length });
  }

  return bad("method not allowed", 405);
};

export const config = {
  path: ["/api/fiches", "/api/fiches/:id"],
  method: ["GET", "POST", "PATCH", "DELETE"],
};
