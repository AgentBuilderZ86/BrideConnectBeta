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

**Messagerie WhatsApp / Teams (onglet « Messagerie », site web)**
- La conversation complète passe par la messagerie : texte, notes vocales (transcrites et traduites, darija comprise), photos et réponses rapides. L'agent construit un brouillon de fiche relié à la conversation, envoie un récapitulatif quand la fiche est prête, et la transmet quand on répond « OUI » (« wakha » et « واخا » sont aussi compris).
- Les relances reviennent sur le même fil. La réponse du porteur est transformée en mise à jour ou en mesure de valeur, puis confirmée par « OUI ».
- Un téléphone simulé exécute exactement la logique des connecteurs réels :
  - `/api/channel/whatsapp` : webhook WhatsApp Business Cloud API, avec signature vérifiée par `WHATSAPP_APP_SECRET`. Il faut aussi `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` et `WHATSAPP_VERIFY_TOKEN`. `WHATSAPP_NUDGE_TEMPLATE` (facultatif) désigne le modèle approuvé utilisé pour les relances hors de la fenêtre de 24 h.
  - `/api/channel/teams` : point de terminaison d'un bot Azure, avec jeton Bot Framework vérifié. Variables : `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD` et `TEAMS_TENANT_ID`.
- Ces deux connecteurs suivent les spécifications publiées mais n'ont pas été testés contre de vrais comptes WhatsApp ou Teams.

**Pilotage automatique**
- Tournée quotidienne à 7 h (heure du Maroc), via une fonction planifiée et une fonction en arrière-plan. L'agent repère :
  - les informations périmées ;
  - les hypothèses non confirmées depuis plus de 7 jours ;
  - les propositions sans réponse ;
  - l'inactivité ;
  - les retards de la DSI ;
  - la valeur à mesurer.
- Il rédige les relances, les envoie sur le canal d'origine du besoin (WhatsApp, Teams, e-mail ou application) et consigne tout dans le journal.
- Bilan hebdomadaire chaque lundi à 7 h : synthèse, décisions à prendre, alertes. Il est envoyé à `DSI_EMAIL` si l'envoi d'e-mails est configuré.
- Historique des tournées et des bilans dans l'outil « Pilotage automatique », avec lancement manuel à la date de l'horloge de démo. Les appels planifiés s'authentifient avec `PILOT_SECRET`.

**Boucle de valeur**
- Deux nouveaux statuts : *En réalisation* et *En production*. L'agent propose 1 à 3 indicateurs tirés de la fiche, avec une valeur « avant » uniquement si la fiche la donne. La DSI les valide.
- Après 30 jours en production, la tournée demande la mesure au porteur. Sa réponse, sur n'importe quel canal, est enregistrée en face de l'indicateur.
- Tableau de bord « Valeur & indicateurs » : délai de première réponse de la DSI, part des fiches à jour, besoins par statut, valeur attendue face à la valeur mesurée.

**Portefeuille et feuille de route (outil « Feuille de route » de la File DSI)**
- L'agent regroupe les besoins de toutes les directions en cas d'usage, avec famille IA, métiers, valeur, faisabilité, prérequis, dépendances et contrainte à anticiper. Il repère les socles transverses, puis répartit le tout en trois vagues : 0 à 6 mois, 6 à 18 mois, au-delà.
- Les notes du copilote sont réutilisées quand elles existent ; sinon, l'agent les marque « estimées ».
- La construction tourne en arrière-plan (`/api/portfolio-bg`) et chaque version est conservée.
- Export Excel au format de l'onglet `Suivi_Cas_Usage` du Toolkit de pilotage :
  - Score Priorité calculé par formule (Valeur × Faisabilité) ;
  - colonnes humaines (Décision COPIL, Complexité) laissées vides ;
  - onglets Socles, Feuille_de_route, Besoins et Notes.
- Support COPIL en PowerPoint : synthèse, feuille de route, matrice, une diapositive par vague, décisions attendues.

**Console d'administration (onglet « Administration »)**
- Réglages modifiables sans code et appliqués par tous les agents en moins d'une minute : instructions de l'agent d'intake, grille de qualification, durées de validité, seuils de relance, directions, signature.
- Chaque enregistrement crée une version restaurable.
- Banc d'essai : des cas de test modifiables sont envoyés à l'agent avec les réglages affichés, même non enregistrés. Chaque réponse passe des contrôles fixes (JSON, 3 questions au plus, statuts, longueur, temps de réponse), puis un jugement par IA au regard des attentes. Les derniers passages sont historisés.
- Si `ADMIN_CODE` est défini, l'administration exige aussi ce code (en-tête `x-admin-code`).

**Application mobile**
- Le site s'installe comme une application (manifeste, service worker, icônes) et s'ouvre même hors connexion sur la dernière version chargée.
- Notifications Web Push sur chaque appareil abonné, pour les besoins qu'il suit : questions de l'agent (relances), réponses de la DSI, changements de statut. Un clic ouvre directement le besoin.
- Clés VAPID : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (facultatif). Sur iPhone, les notifications ne fonctionnent qu'une fois l'application ajoutée à l'écran d'accueil (iOS 16.4 ou plus récent).

**Pièces jointes et vision**
- Photos, PDF, Excel (.xlsx), Word (.docx), PowerPoint (.pptx) et texte (CSV, TXT), 3 fichiers de 4 Mo au plus par message, sur le web, WhatsApp (documents), Teams et l'e-mail (pièces jointes du webhook Postmark).
- Les PDF et les images sont lus directement par le modèle ; le texte des fichiers Office est extrait sans dépendance (`netlify/lib/extract.mjs` : onglets, dates Excel converties, tableaux Word, diapositives).
- L'agent cite la source de chaque valeur lue (« d'après Releve.xlsx, onglet … »), la marque « Proposé par l'agent », montre ses calculs et ne recopie aucune donnée personnelle de tiers. Ce qu'il a retenu de chaque pièce est affiché avec le fichier, que la DSI peut rouvrir.

**Doublons et synergies**
- À chaque transmission, le besoin est comparé aux autres en arrière-plan : doublon (même problème, même processus, même sur un autre site) ou synergie (mêmes données, même solution, même prérequis), avec la raison, sur les deux fiches.
- Outil DSI « Doublons & synergies » : analyse de tout le portefeuille par grappes, fiche principale proposée pour les doublons.
- Fusion : l'agent rédige la fiche commune (sites, volumes, contraintes de chaque demandeur), la DSI valide champ par champ ; les fiches absorbées passent « Fusionné », leurs porteurs deviennent co-porteurs et sont prévenus sur leur canal. Mise en relation des porteurs en un clic.

**Du besoin au projet**
- Dossier de cadrage généré en arrière-plan à partir de la fiche, de la qualification, des indicateurs et des pièces : contexte, objectifs, périmètre, parties prenantes, exigences MoSCoW, données, épopées et user stories avec critères d'acceptation, plan de POC avec go / no go, business case (chiffres de la fiche uniquement, sinon « à chiffrer »), risques, jalons, questions ouvertes.
- Exports : Word (.docx), backlog Jira (CSV, épopées et stories reliées) et Azure DevOps (CSV hiérarchique Epic / User Story).
- Suivi de livraison dans la fiche (À faire, En cours, Fait) avec avancement pondéré par les points ; le porteur voit ce qui est livré et reçoit une notification.

**Prêt pour l'entreprise**
- Connexion Microsoft Entra ID (OpenID Connect, code d'autorisation avec PKCE) dès que `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` et `ENTRA_CLIENT_SECRET` sont définis (URI de redirection : `https://<site>/api/auth/callback`). Rôle : rôle d'application Entra (`Metier`, `DSI`, `Direction`, `Admin`), sinon la liste « adresse = rôle » de l'administration, sinon Métier. Session dans un cookie signé (`SESSION_SECRET`, sinon un secret généré et gardé dans Blobs), 8 heures.
- Rôles vérifiés par l'API sur chaque route : Métier (ses besoins seulement), Direction (lecture de la file, du portefeuille, de la valeur), DSI (qualification, relances, fusions, cadrage, pilotage), Administrateur (réglages, audit, demandes loi 09-08). Sans Entra, un sélecteur de personnes sert à la démonstration ; sans session, le code de démo donne tous les droits, sauf si `AUTH_REQUIRED=1`.
- Journal d'audit : une entrée par action (connexions, transmissions, statuts, qualifications, fusions, cadrages, réglages, consultations de pièces, exports et effacements), jamais réécrite, filtrable et exportable en CSV.
- Loi 09-08 (CNDP) : information préalable sur chaque canal, consentement horodaté et versionné sur la fiche ; droits d'accès et d'effacement en libre-service (« Mes besoins », ou MES DONNÉES / SUPPRIMER MES DONNÉES sur WhatsApp et Teams ; STOP arrête les relances) ou par l'administrateur ; durées de conservation appliquées chaque jour (brouillons abandonnés supprimés, besoins clos anonymisés, conversations et journal purgés) ; registre du traitement, sous-traitants et liste de contrôle dans l'administration.

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
- `netlify/functions/agent.mjs` (`POST /api/agent`) : appelle Claude via la passerelle IA de Netlify, sans clé API à gérer, et renvoie la réponse en flux. Modes : `intake` (par défaut), `update`, `observe`, `nudge`, `qualify`, `indicateurs`. Les instructions de chaque mode sont dans `netlify/lib/prompts.mjs`. Limité à 30 appels par minute et par adresse IP.
- `netlify/functions/fiches.mjs` (`GET`/`POST /api/fiches`, `GET`/`PATCH /api/fiches/:id`, `DELETE /api/fiches?all=1`) : file DSI stockée dans Netlify Blobs (store `fiches`). Le `PATCH` prend une opération : `statut`, `submit`, `apply`, `propose`, `dismiss`, `qualif`, `nudge`, `reponse`, `note`, `valeur_def`, `mesure`. Chaque opération est consignée dans le journal de la fiche.
- `netlify/functions/transcribe.mjs` (`POST /api/transcribe`) : transcription par Gemini via la passerelle IA de Netlify.
- `netlify/functions/inbound-email.mjs` (`POST /api/inbound-email`) : canal e-mail.
- `netlify/lib/channels.mjs` : logique de conversation commune à tous les canaux de messagerie. Elle sert `channel-simulate.mjs`, `channel-whatsapp.mjs` et `channel-teams.mjs` ; les envois passent par `netlify/lib/adapters.mjs`.
- `netlify/lib/pilot.mjs` : tournée quotidienne, bilan hebdomadaire et indicateurs. Fonctions associées : `pilot-daily.mjs` et `pilot-weekly.mjs` (planifiées), `pilot-bg.mjs` (en arrière-plan), `pilot.mjs` (lecture).
- `netlify/lib/config.mjs` et `admin-config.mjs`, `admin-eval.mjs`, `config.mjs` : réglages versionnés et banc d'essai.
- `netlify/lib/portfolio.mjs` et `portfolio.mjs`, `portfolio-bg.mjs` : portefeuille et feuille de route.
- `netlify/lib/push.mjs` et `push.mjs` : abonnements et envoi des notifications. `static/` contient le manifeste, le service worker et les icônes, copiés dans `public/` par `build.mjs`.
- Stockage Netlify Blobs : `fiches`, `conversations`, `pilot`, `config`, `push`, `pieces`, `audit`.
- `netlify/lib/session.mjs` et `auth.mjs` (`/api/auth/me|demo|login|callback|logout`) : sessions, rôles et droits ; `netlify/lib/audit.mjs` et `audit.mjs` (`GET /api/audit`).
- `netlify/lib/pieces.mjs`, `extract.mjs` et `pieces.mjs` (`GET /api/pieces/:id`) : pièces jointes.
- `netlify/lib/synergies.mjs`, `synergies.mjs` et `synergies-bg.mjs` : doublons et synergies ; opérations `fusion`, `relation`, `proche_ecarte` du `PATCH /api/fiches/:id`.
- `netlify/lib/cadrage.mjs` et `cadrage-bg.mjs` : dossier de cadrage ; opération `story` pour le suivi de livraison.
- `netlify/lib/privacy.mjs` et `privacy.mjs` (`GET`/`POST /api/privacy`) : notice, consentement, export, effacement, conservation.
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

- Les connecteurs WhatsApp et Teams sont écrits mais n'ont pas été testés avec de vrais comptes. Il faut un compte WhatsApp Business (Meta) et une inscription de bot Azure dans le tenant. L'e-mail entrant nécessite un service tiers (Postmark, SendGrid, Mailgun…) relié à `/api/inbound-email`.
- L'horloge de démo n'agit que sur les calculs de la page et sur les tournées lancées à la main. Les messages reçus par messagerie sont horodatés à l'heure réelle.
- L'observation se fait par signaux collés à la main. En production, des connecteurs (ITSM, Planner, comptes rendus Teams, SAP/BI) appelleraient le même mode `observe`.
- La connexion Microsoft Entra ID est écrite mais n'a pas été testée avec un vrai tenant. Tant que `AUTH_REQUIRED=1` n'est pas posé, le code de démo donne tous les droits : le sélecteur de personnes montre les rôles, il ne protège rien.
- Les données sont traitées hors du Maroc (Netlify, Anthropic, Google) : une autorisation de transfert de la CNDP, ou un hébergement adapté, est nécessaire avant une mise en production.
- Les fichiers .xls (ancien format Excel) ne sont pas lus : il faut les enregistrer en .xlsx.
- Les fonctions de la fiche vivante, le copilote et la dictée n'existent que sur le site web, pas dans la version claude.ai.
- Pas de module d'administration ni de connexion SAP/BI pour mesurer la valeur réelle.
