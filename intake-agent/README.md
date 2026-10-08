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

**Après l'envoi : la fiche vivante (onglet « Mes besoins », site web)**
- Chaque champ garde sa date de mise à jour et sa source. Au-delà d'une durée de validité propre au champ (90 jours pour le coût, par exemple), il est signalé « À revalider ».
- « Donner des nouvelles » : le porteur écrit ou dicte ce qui a changé. L'agent propose les champs à modifier, le porteur valide.
- Questions ciblées de l'agent (relances), auxquelles on répond en un clic.
- Mises à jour issues de l'observation du terrain (comptes rendus, tickets, données), soumises au porteur pour validation. L'agent n'écrase jamais rien seul.
- Journal daté de tout ce qui arrive au besoin, y compris la réponse de la DSI.

**Canaux de capture (site web)**
- Dictée vocale en français, darija, arabe ou anglais : transcription et traduction française (`/api/transcribe`).
- E-mail entrant : `/api/inbound-email` crée un brouillon de fiche et prépare une réponse avec les questions de l'agent et un lien pour compléter. Le corps attendu suit le format webhook de Postmark (`From`, `FromName`, `Subject`, `TextBody`) ou `{from, subject, text}`, authentifié par `?token=<INBOUND_TOKEN>`. L'envoi de la réponse est activé si `RESEND_API_KEY` et `RESEND_FROM` sont définis.

**Côté DSI (onglet « File DSI »)**
- Fiches reçues avec leur niveau de maturité, leur urgence, les points signalés par l'agent et l'historique complet de l'échange.
- Échéance de retour calculée à 5 jours ouvrables, avec signalement des retards.
- Changement de statut (*À qualifier*, *En qualification*, *Qualifié — à instruire*, *Réorienté*, *Clos*) pour les éditeurs de la page.
- Copilote de qualification (site web) : notes Valeur et Faisabilité de 1 à 5 justifiées, lecture « bottleneck shift » (contrainte actuelle, contrainte déplacée, chaîne de second ordre), trajectoire A / B / C proposée, prérequis, questions d'atelier, besoins proches et brouillon de réponse au porteur. Tout reste une proposition IA à valider par la DSI ; aucun chiffre n'est inventé.
- Outils (site web) : matrice valeur / faisabilité, relances préparées par l'agent, analyse d'un signal terrain, simulation d'e-mail entrant, horloge de démo (+7, +30, +100 jours) pour montrer le vieillissement des informations, remise à zéro de la file.

## Architecture du prototype

Une seule page source, `index.html`, qui fonctionne dans deux environnements.

### Site web autonome (Netlify)

- `build.mjs` génère `public/index.html` (la page dans un document HTML complet) et `netlify/lib/rules.mjs` (les instructions de l'agent, gardées côté serveur).
- `netlify/functions/agent.mjs` (`POST /api/agent`) : appelle Claude via la passerelle IA de Netlify, sans clé API à gérer, et renvoie la réponse en flux. Modes : `intake` (par défaut), `update`, `observe`, `nudge`, `qualify`. Les instructions de chaque mode sont dans `netlify/lib/prompts.mjs`. Limité à 30 appels par minute et par adresse IP.
- `netlify/functions/fiches.mjs` (`GET`/`POST /api/fiches`, `GET`/`PATCH /api/fiches/:id`, `DELETE /api/fiches?all=1`) : file DSI stockée dans Netlify Blobs (store `fiches`). Le `PATCH` prend une opération : `statut`, `submit`, `apply`, `propose`, `dismiss`, `qualif`, `nudge`, `reponse`, `note`. Chaque opération est consignée dans le journal de la fiche.
- `netlify/functions/transcribe.mjs` (`POST /api/transcribe`) : transcription par Gemini via la passerelle IA de Netlify.
- `netlify/functions/inbound-email.mjs` (`POST /api/inbound-email`) : canal e-mail.
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

- Teams et WhatsApp ne sont pas branchés. L'e-mail entrant nécessite un service tiers (Postmark, SendGrid, Mailgun…) relié à `/api/inbound-email`.
- L'observation se fait par signaux collés à la main. En production, des connecteurs (ITSM, Planner, comptes rendus Teams, SAP/BI) appelleraient le même mode `observe`.
- Les relances sont préparées à la demande. En production, une fonction planifiée les générerait et les enverrait sur le canal du destinataire.
- Pas d'identité : « Mes besoins » repose sur le navigateur. Le code d'accès de démo n'est pas une authentification.
- Les fonctions de la fiche vivante, le copilote et la dictée n'existent que sur le site web, pas dans la version claude.ai.
- Toutes les personnes ayant accès à la page voient la file DSI. En production, la lecture serait réservée à la DSI et au porteur du besoin.
- Pas de module d'administration ni de connexion SAP/BI pour mesurer la valeur réelle.
