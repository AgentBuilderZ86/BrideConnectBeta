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
const at = (m) => new Date(Date.parse('2026-10-09T08:12:00Z') + m * 60000).toISOString();
const SIM = { ficheId: 'f3', messages: [
  { dir: 'in', kind: 'audio', duree: 18, at: at(0), langue: 'darija', transcription: "La centrifugeuse 3 s'est encore arrêtée cette nuit. On perd presque un poste de production à chaque panne et on ne voit rien venir." },
  { dir: 'out', at: at(1), text: "Merci, c'est noté dans votre fiche. Combien d'arrêts imprévus avez-vous eu sur les 3 derniers mois ? Et avez-vous un historique des vibrations ou des températures ?", quick: ["4 ou 5 arrêts", "Plus de 10", "Je ne sais pas"] },
  { dir: 'in', at: at(3), text: "4 ou 5 arrêts. Les relevés sont dans la GMAO." },
  { dir: 'out', at: at(4), text: "Votre fiche est prête (48 %). Je la transmets à la DSI ? Répondez OUI pour confirmer.", quick: ["OUI", "Je complète"] },
  { dir: 'in', at: at(5), text: "واخا" },
  { dir: 'out', at: at(5), text: "Fiche transmise à la DSI & TD. Retour attendu sous 5 jours ouvrables." },
]};
const PF = { portfolio: { version: 3, at: '2026-10-09T07:00:00Z', besoins_consideres: 5,
  synthese: "Cinq besoins regroupés en quatre cas d'usage autour d'un socle de données financières et industrielles commun.",
  vagues: [{ numero: 1, nom: "Gains rapides", horizon: "0 à 6 mois", objectif: "automatiser les consolidations" }, { numero: 2, nom: "Données fiables", horizon: "6 à 18 mois", objectif: "qualité et traçabilité" }, { numero: 3, nom: "IA industrielle", horizon: "au-delà", objectif: "maintenance prédictive" }],
  socles: [{ id: 'S1', nom: "Socle de données SAP", description: "Extractions SAP normalisées et référentiel commun des comptes.", sert: ['CU1', 'CU2'], vague: 1 }],
  cas_usage: [
    { id: 'CU1', nom: "Consolidation automatique de la clôture", famille: "Automatisation", metiers: ["Finance"], description: "Extractions SAP consolidées sans ressaisie, écarts signalés.", valeur: { note: 4 }, faisabilite: { note: 4 }, vague: 1, besoins: ['f1'] },
    { id: 'CU2', nom: "Comparateur de devis", famille: "IA documentaire", metiers: ["Achats"], description: "Lecture des devis reçus et historique des prix payés.", valeur: { note: 4 }, faisabilite: { note: 5 }, vague: 1, besoins: ['f2'] },
    { id: 'CU3', nom: "Suivi des ventes et des non-conformités", famille: "Tableau de bord", metiers: ["Commercial", "Qualité"], description: "Indicateurs hebdomadaires sans consolidation manuelle.", valeur: { note: 3 }, faisabilite: { note: 4 }, vague: 2, besoins: ['f4', 'f5'] },
    { id: 'CU4', nom: "Maintenance prédictive des centrifugeuses", famille: "IA prédictive", metiers: ["Maintenance"], description: "Anticiper les arrêts à partir des relevés de la GMAO.", valeur: { note: 5 }, faisabilite: { note: 2 }, vague: 3, besoins: ['f3'], dependances: ['S1'] },
  ], decisions_copil: ["Valider le socle de données SAP en vague 1", "Lancer le POC maintenance prédictive après la campagne"] } };
const { b, page } = await open({ api: async (p, req) => {
  if (p === '/api/auth/me') return json({ perms: PERMS, role: 'admin', demoLogin: true });
  if (p === '/api/fiches' && req.method() === 'GET') return json({ items: store });
  if (p.startsWith('/api/channel/simulate')) return json(SIM);
  if (p === '/api/portfolio') return json(PF);
}});
await page.waitForTimeout(1000);
await page.click('#tab-chat'); await page.waitForTimeout(900);
await page.screenshot({ path: O + '/chat.png' });
await page.click('#tab-dsi'); await page.waitForTimeout(500);
await page.click('[data-tool="roadmap"]'); await page.waitForTimeout(900);
await page.locator('.board').first().scrollIntoViewIfNeeded().catch(()=>{});
await page.waitForTimeout(300);
await page.screenshot({ path: O + '/roadmap.png' });
await b.close();
