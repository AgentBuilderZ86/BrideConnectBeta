import { store as ficheStore, ficheForAgent, valueForAgent, addEvent, frDate } from "./fiche.mjs";
import { askJSON } from "./claude.mjs";
import { CADRAGE } from "./prompts.mjs";
import { getConfig } from "./config.mjs";

// From qualified need to project: scoping file, backlog and POC plan, stored on the fiche.
const arr = (x, n = 30) => (Array.isArray(x) ? x.slice(0, n) : []);
const str = (x, n = 1200) => String(x ?? "").slice(0, n);
const PRIO = ["Must", "Should", "Could", "Won't"];

function clean(r) {
  const stories = arr(r.user_stories, 25).filter((u) => u && u.je_veux).map((u, i) => ({
    id: str(u.id || `US-${String(i + 1).padStart(2, "0")}`, 12), epic: str(u.epic, 12), en_tant_que: str(u.en_tant_que, 200), je_veux: str(u.je_veux, 400), afin_de: str(u.afin_de, 400),
    criteres: arr(u.criteres, 6).map((c) => str(c, 500)), priorite: PRIO.includes(u.priorite) ? u.priorite : "Should", points: [1, 2, 3, 5, 8, 13, 21].includes(Number(u.points)) ? Number(u.points) : null, statut: "À faire",
  }));
  return {
    resume: str(r.resume), contexte: str(r.contexte, 3000), objectifs: arr(r.objectifs, 10).map((x) => str(x, 400)),
    perimetre: { inclus: arr(r.perimetre?.inclus, 12).map((x) => str(x, 400)), exclus: arr(r.perimetre?.exclus, 12).map((x) => str(x, 400)) },
    parties_prenantes: arr(r.parties_prenantes, 12).map((p) => ({ role: str(p?.role, 120), qui: str(p?.qui, 160) })),
    exigences_fonctionnelles: arr(r.exigences_fonctionnelles, 25).map((e, i) => ({ id: str(e?.id || `EF-${String(i + 1).padStart(2, "0")}`, 12), texte: str(e?.texte, 500), priorite: PRIO.includes(e?.priorite) ? e.priorite : "Should" })),
    exigences_non_fonctionnelles: arr(r.exigences_non_fonctionnelles, 15).map((x) => str(x, 400)),
    donnees: arr(r.donnees, 15).map((d) => ({ source: str(d?.source, 200), usage: str(d?.usage, 300), etat: str(d?.etat, 40) })),
    epics: arr(r.epics, 6).map((e, i) => ({ id: str(e?.id || `E${i + 1}`, 12), titre: str(e?.titre, 160), objectif: str(e?.objectif, 400) })),
    user_stories: stories,
    poc: { duree_semaines: Number(r.poc?.duree_semaines) || null, objectif: str(r.poc?.objectif, 600), etapes: arr(r.poc?.etapes, 10).map((e) => ({ periode: str(e?.periode, 30), livrable: str(e?.livrable, 400) })), criteres_succes: arr(r.poc?.criteres_succes, 8).map((x) => str(x, 400)), go_no_go: str(r.poc?.go_no_go, 600) },
    business_case: { gains: arr(r.business_case?.gains, 10).map((g) => ({ nature: str(g?.nature, 160), hypothese: str(g?.hypothese, 400), estimation: str(g?.estimation, 200) })), couts: arr(r.business_case?.couts, 10).map((c) => ({ poste: str(c?.poste, 160), estimation: str(c?.estimation, 200) })), conclusion: str(r.business_case?.conclusion, 800) },
    risques: arr(r.risques, 12).map((x) => ({ risque: str(x?.risque, 300), parade: str(x?.parade, 300) })),
    jalons: arr(r.jalons, 12).map((j) => ({ nom: str(j?.nom, 160), echeance: str(j?.echeance, 30) })),
    questions_ouvertes: arr(r.questions_ouvertes, 10).map((x) => str(x, 400)),
  };
}

export async function buildCadrage(id) {
  const fs = ficheStore();
  const doc = await fs.get(id, { type: "json" });
  if (!doc) throw new Error("fiche introuvable");
  const cfg = await getConfig();
  const parts = [
    `DATE DU JOUR : ${frDate(Date.now())}`,
    `FICHE « ${doc.titre} » (statut ${doc.statut}) :\n${ficheForAgent(doc.fiche, Date.now(), cfg.ttl)}`,
    doc.qualif ? `QUALIFICATION DU COPILOTE (validée ou à valider par la DSI) :\n${JSON.stringify({ valeur: doc.qualif.valeur, faisabilite: doc.qualif.faisabilite, trajectoire: doc.qualif.trajectoire, bottleneck_actuel: doc.qualif.bottleneck_actuel, bottleneck_potentiel: doc.qualif.bottleneck_potentiel, chaine_second_ordre: doc.qualif.chaine_second_ordre, prerequis: doc.qualif.prerequis })}` : "QUALIFICATION : (aucune)",
    valueForAgent(doc) ? `INDICATEURS DE VALEUR :\n${JSON.stringify(valueForAgent(doc))}` : "",
    (doc.pieces || []).length ? `PIÈCES JOINTES :\n${doc.pieces.map((p) => `- ${p.name} (${p.label || p.kind})${p.retenu ? " : " + p.retenu : ""}`).join("\n")}` : "",
    (doc.coporteurs || []).length ? `CO-PORTEURS (besoins fusionnés) :\n${doc.coporteurs.map((c) => `- ${c.titre} (${c.direction || "?"})`).join("\n")}` : "",
    (doc.alertes || []).length ? `POINTS SIGNALÉS PAR L'AGENT D'INTAKE :\n${doc.alertes.map((x) => "- " + x.texte).join("\n")}` : "",
    `JOURNAL (derniers événements) :\n${(doc.events || []).slice(-12).map((e) => `- ${frDate(e.at)} ${e.text}`).join("\n")}`,
  ].filter(Boolean);
  const res = await askJSON({ system: CADRAGE, effort: "medium", messages: [{ role: "user", content: parts.join("\n\n") }] });
  const c = clean(res);
  if (!c.user_stories.length) throw new Error("dossier incomplet : aucune user story");
  const fresh = await fs.get(id, { type: "json" });
  const prev = fresh.cadrage;
  // Keeps delivery progress of stories that still exist after a regeneration.
  for (const u of c.user_stories) { const o = (prev?.user_stories || []).find((x) => x.id === u.id && x.je_veux === u.je_veux); if (o) { u.statut = o.statut; u.maj = o.maj; } }
  const done = c.user_stories.filter((u) => u.statut === "Fait"), pts = (l) => l.reduce((n, u) => n + (u.points || 0), 0);
  const at = new Date().toISOString();
  fresh.cadrage = { ...c, at, version: (prev?.version || 0) + 1, avancement: { faites: done.length, total: c.user_stories.length, pct: pts(c.user_stories) ? Math.round(100 * pts(done) / pts(c.user_stories)) : 0 } };
  delete fresh.cadrageRunning; delete fresh.cadrageError;
  addEvent(fresh, { at, type: "cadrage", by: "agent", text: `Dossier de cadrage ${prev ? `régénéré (v${fresh.cadrage.version})` : "généré"} : ${c.epics.length} épopée(s), ${c.user_stories.length} user stories${c.poc.duree_semaines ? `, POC de ${c.poc.duree_semaines} semaines` : ""}. Proposition à valider par la DSI.` });
  await fs.setJSON(id, fresh);
  return fresh.cadrage;
}
