# Agent d'Intake Innovation — prototype

Prototype d'un agent qui transforme un besoin exprimé en texte libre en **Fiche d'Expression de Besoin — Innovation Digitale & IA** complète et challengée, puis la transmet à une file de qualification DSI.

- Site de démo : https://agent-intake-innovation.netlify.app (code d'accès requis : variable `DEMO_CODE` du projet Netlify)
- Version claude.ai : https://claude.ai/artifact/6cbjANLUu9U4Je58reuiXm

## Ce que fait le prototype

**Côté métier (onglet « Exprimer un besoin »)**
- L'utilisateur décrit son besoin en quelques phrases. Il peut aussi joindre une photo : tableau blanc, capture Excel, document.
- L'agent remplit la fiche en direct (panneau de droite). Chaque champ porte un statut : *À compléter*, *Proposé par l'agent*, *Déclaré* ou *Confirmé*.
- L'agent challenge le besoin, avec au plus 3 questions par tour. Il remonte au problème quand une solution est déguisée en besoin, fait chiffrer le coût en proposant des ordres de grandeur, et précise la valeur, les données et les contraintes.
- Des réponses courtes à cliquer réduisent l'effort de saisie.
- L'utilisateur confirme une proposition en un clic ou modifie un champ lui-même. L'agent ne réécrit jamais un champ confirmé avec une supposition.
- Une jauge de maturité suit la fiche, ainsi que la liste des points à renforcer. La transmission n'est jamais bloquée.
- Avant l'envoi, l'utilisateur relit la fiche au format officiel (sections 1 à 6). Une case de validation remplace la signature du responsable métier. La fiche est téléchargeable au format Word.
- L'agent détecte les doublons en comparant avec les besoins déjà transmis.

**Côté DSI (onglet « File DSI »)**
- Fiches reçues avec leur niveau de maturité, leur urgence, les points signalés par l'agent et l'historique complet de l'échange.
- Échéance de retour calculée à 5 jours ouvrables, avec signalement des retards.
- Changement de statut (*À qualifier*, *En qualification*, *Qualifié — à instruire*, *Réorienté*, *Clos*) pour les éditeurs de la page.

## Architecture du prototype

Une seule page source, `index.html`, qui fonctionne dans deux environnements.

### Site web autonome (Netlify)

- `build.mjs` génère `public/index.html` (la page dans un document HTML complet) et `netlify/lib/rules.mjs` (les instructions de l'agent, gardées côté serveur).
- `netlify/functions/agent.mjs` (`POST /api/agent`) : appelle Claude via la passerelle IA de Netlify, sans clé API à gérer, et renvoie la réponse en flux. Limité à 20 appels par minute et par adresse IP.
- `netlify/functions/fiches.mjs` (`GET`/`POST /api/fiches`, `PATCH /api/fiches/:id`) : file DSI stockée dans Netlify Blobs (store `fiches`).
- `DEMO_CODE` : si cette variable d'environnement est définie, chaque appel d'API doit porter ce code (en-tête `x-demo-code`). La page le demande une seule fois et le mémorise.
- Déploiement : `netlify.toml` lance `node build.mjs` et publie `public/`.

### Version claude.ai (Artifact)

La même page, publiée sans build ni dépendance :
- **Agent** : capacité `sample` du runtime Artifact (appel à Claude au nom de l'utilisateur, sans clé API). Les instructions de l'agent sont dans la constante `RULES` de `index.html`.
- **File DSI** : capacité `db` (collection `fiches`, partagée entre les personnes qui ont accès à la page).
- **Identité** : capacité `user`. Le nom du profil pré-remplit « Responsable métier » comme proposition à confirmer.
- **Export** : capacité `downloads` (fichier `.doc`).
- **Brouillon** : `localStorage`. La conversation en cours survit à un rechargement.

## Limites connues (prototype)

- Un seul canal (web). Teams, e-mail, WhatsApp et la voix sont prévus dans la cible.
- Pas encore de mise à jour par observation (ITSM, Planner, comptes rendus), ni de relances ciblées dans le temps.
- Toutes les personnes ayant accès à la page voient la file DSI. En production, la lecture serait réservée à la DSI et au porteur du besoin.
- Pas de module d'administration ni de connexion SAP/BI pour mesurer la valeur réelle.
