import { open } from './cap.mjs';
import { PERMS, json } from './mock.mjs';
import { readFileSync } from 'node:fs';
const O = process.argv[2];
const base = JSON.parse(readFileSync(O + '/doc.json', 'utf8'));
const day = (d) => new Date(Date.parse('2026-10-09T09:00:00Z') - d * 864e5).toISOString();
const Q1 = { valeur: { note: 4, justification: "108 jours-homme par an déclarés et un comité de direction qui attend des chiffres plus tôt : gain de temps direct et meilleure décision." },
  faisabilite: { note: 4, justification: "Les données existent déjà dans SAP ; le point dur est le référentiel commun des comptes entre sites." },
  trajectoire: { code: "B", libelle: "Automatisation et tableau de bord", critere: "Données SAP disponibles, règle de consolidation stable." },
  bottleneck_actuel: { categorie: "Temps humain", description: "3 personnes bloquées 3 jours par clôture." },
  bottleneck_potentiel: { categorie: "Qualité des données", description: "Les écarts de mapping entre sites deviendront visibles plus tôt." },
  chaine_second_ordre: "Clôture plus rapide → comité de direction plus tôt → arbitrages mensuels avancés.",
  prerequis: ["Référentiel commun des comptes validé par la Finance", "Accès en lecture aux extractions SAP de chaque site"],
  questions_atelier: ["Quelle date de remise le comité de direction attend-il ?", "Qui arbitre les écarts entre sites aujourd'hui ?"],
  reponse_metier: "Bonjour Karim, merci pour cette fiche claire. Nous proposons un atelier de 1 h la semaine prochaine pour valider le référentiel des comptes et la date de remise attendue." };
const mk = (id, titre, dir, urg, score, statut, d, qualif, origine = 'web') => ({ ...base, id, titre, score, statut, submittedAt: day(d), echeance: day(d - 7), origine, qualif,
  fiche: { ...base.fiche, direction: { ...base.fiche.direction, valeur: dir }, urgence: { ...base.fiche.urgence, valeur: urg } } });
const store = [
  { ...base, id: 'f1', qualif: Q1, statut: 'En qualification' },
  mk('f2', "Comparaison des devis fournisseurs", "Achats", "Court terme (< 3 mois)", 71, 'Qualifié — à instruire', 6, { valeur: { note: 4 }, faisabilite: { note: 5 }, trajectoire: { code: "A", libelle: "Outil existant à configurer" } }, 'e-mail'),
  mk('f3', "Anticiper les pannes des centrifugeuses", "Maintenance — Raffinerie", "Moyen terme (3–12 mois)", 48, 'En qualification', 9, { valeur: { note: 5 }, faisabilite: { note: 2 }, trajectoire: { code: "C", libelle: "Projet IA avec POC" } }, 'whatsapp'),
  mk('f4', "Consolidation hebdomadaire des ventes", "Commercial", "Court terme (< 3 mois)", 66, 'À qualifier', 2, { valeur: { note: 3 }, faisabilite: { note: 4 }, trajectoire: { code: "B", libelle: "Automatisation et tableau de bord" } }, 'teams'),
  mk('f5', "Suivi des non-conformités qualité", "Qualité — Raffinerie", "Moyen terme (3–12 mois)", 57, 'À qualifier', 1, { valeur: { note: 3 }, faisabilite: { note: 3 }, trajectoire: { code: "B", libelle: "Automatisation et tableau de bord" } }),
];
const { b, page } = await open({ api: async (p, req) => {
  if (p === '/api/auth/me') return json({ perms: PERMS, role: 'admin', demoLogin: true });
  if (p === '/api/fiches' && req.method() === 'GET') return json({ items: store });
  if (p.startsWith('/api/fiches/')) return json(store.find(x => p.endsWith(x.id)) || {});
}});
await page.waitForTimeout(1000);
await page.click('#tab-dsi'); await page.waitForTimeout(800);
await page.screenshot({ path: O + '/dsi.png' });
await page.locator('.qcard, [data-open], .card').first().click().catch(e=>console.log('noclick',e.message.slice(0,80)));
await page.waitForTimeout(600);
await page.screenshot({ path: O + '/dsi-open.png' });
const cp = page.locator('.copilot').first();
if (await cp.count()) { await cp.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await page.screenshot({ path: O + '/copilot.png' }); }
await page.click('[data-tool="matrix"]'); await page.waitForTimeout(600);
await page.locator('#tool-panel, .tool-panel, .tp-head').first().scrollIntoViewIfNeeded().catch(()=>{});
await page.screenshot({ path: O + '/matrix.png' });
const btns = await page.evaluate(() => [...document.querySelectorAll('#view-dsi button')].slice(0, 30).map(x => (x.dataset.tool || x.dataset.act || x.id || '') + '|' + x.textContent.trim().slice(0, 30)).join('\n'));
console.log(btns);
await b.close();
