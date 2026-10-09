export const PERMS = ["admin","demo.reset","fiche.create","fiche.dsi","fiche.read","portfolio.build","portfolio.read","pilot.read"];
export const stream = (obj) => ({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ d: JSON.stringify(obj) }) + '\n' + JSON.stringify({ done: true, stop: 'end_turn' }) + '\n' });
export const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
export const TURN1 = {
  message: "Merci, le problème est clair : la consolidation manuelle allonge la clôture. Pour chiffrer le coût, j'ai besoin de deux précisions. Combien de personnes du contrôle de gestion y travaillent pendant ces 3 jours ? Et combien de sites envoient leurs extractions SAP ?",
  titre: "Consolidation de la clôture mensuelle",
  maj: {
    direction: { valeur: "Finance — Contrôle de gestion", statut: "déclaré" },
    probleme: { valeur: "À chaque clôture mensuelle, les extractions SAP de tous les sites sont consolidées à la main dans Excel. La consolidation prend 3 jours et les écarts de dernière minute retardent la clôture.", statut: "déclaré" },
    processus: { valeur: "Clôture mensuelle et reporting du comité de direction, exécutés par le contrôle de gestion, 12 fois par an, avec SAP et Excel.", statut: "déduit", note: "reformulation de votre description" },
    decision: { valeur: "Pilotage mensuel du comité de direction sur des chiffres consolidés plus tôt et plus fiables.", statut: "déduit" },
    resultats: { valeur: ["Gain de temps", "Aide à la décision"], statut: "déduit" },
    donnees_existantes: { valeur: "Extractions SAP par site, fichiers Excel de consolidation.", statut: "déclaré" },
    urgence: { valeur: "Court terme (< 3 mois)", statut: "déduit" },
  },
  alertes: [{ type: "quantification", texte: "Coût à chiffrer : nombre de personnes et de sites concernés." }],
  suggestions: ["3 personnes, 6 sites", "5 personnes, 8 sites", "Je ne sais pas"],
  pret: false,
};
export const TURN2 = {
  message: "Je propose un ordre de grandeur : 3 personnes × 3 jours × 12 clôtures, soit environ 108 jours-homme par an. Pouvez-vous le confirmer ? Dernière question : la clôture doit-elle respecter une échéance du Groupe ?",
  titre: "Consolidation de la clôture mensuelle",
  maj: {
    cout: { valeur: "Environ 108 jours-homme par an, plus le retard de la clôture lié aux écarts de dernière minute.", statut: "déduit", note: "3 personnes × 3 jours × 12 clôtures = 108 jours-homme" },
    donnees_manquantes: { valeur: "Référentiel commun des comptes entre sites, à vérifier.", statut: "déduit" },
    contraintes: { valeur: "SAP existant ; reporting attendu par le comité de direction à date fixe.", statut: "déduit" },
    responsable: { valeur: "Karim Bennani, contrôleur de gestion", statut: "déclaré" },
  },
  alertes: [],
  suggestions: ["Oui, je confirme", "Plutôt 4 personnes", "Échéance à J+5"],
  pret: true,
};
