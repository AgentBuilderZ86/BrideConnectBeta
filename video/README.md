# Vidéo explicative AI Bridge

Film de 44 s en 16:9 (1920×1080, 60 i/s, son synthétisé) qui explique le fonctionnement de la plateforme, du besoin métier à la feuille de route. Il est rendu image par image depuis du code avec le moteur du skill *motion-design-studio*.

## Ce que montre le film

| Temps | Plan |
|---|---|
| 0–3 s | Accroche : un pont d'or se tend entre MÉTIER et DSI |
| 3–7 s | 01 Capture multicanal : site web, WhatsApp, Teams, e-mail, note vocale en darija (vrai téléphone simulé) |
| 7–15 s | 02 L'agent challenge et remplit la fiche en direct (vraie conversation, clic sur une réponse courte, zoom sur la jauge) |
| 15–19 s | Rien n'est inventé : la pastille passe par À compléter, Proposé par l'agent, Déclaré, Confirmé, et le calcul s'affiche |
| 19–24 s | 03 La File DSI reçoit les fiches, échéance à 5 jours ouvrables |
| 24–30 s | Le copilote IA propose, la DSI décide : copilote puis matrice valeur / faisabilité |
| 30–35 s | 04 Fiche vivante : J0, J+7, J+30, J+90, tournée quotidienne à 7 h |
| 35–40 s | 05 Feuille de route en trois vagues, export Excel et support COPIL |
| 40–44 s | Logo et « Du besoin métier au projet » |

Les écrans sont de vraies captures de `intake-agent/` : l'application tourne en local, et les réponses de l'API (agent, file DSI, messagerie, portefeuille) sont simulées avec les données de démo (Finance, Achats, Maintenance, Commercial, Qualité). Les chiffres de démonstration (108 jours-homme, notes du copilote) sont illustratifs.

## Contenu

- `film/ai-bridge.html` : le film. `window.seek(t)` peint l'image t, en fonction pure du temps.
- `film/ai-bridge.assets.js` : les captures recadrées et le logo, embarqués en base64.
- `film/brand.css` : Montserrat, IBM Plex Sans et IBM Plex Mono embarquées (licence OFL).
- `film/ai-bridge.shotlist.md` : la liste des plans sur la grille de 120 BPM.
- `film/ai-bridge.review.md` : le journal des trois tours de relecture.
- `capture/` : les scripts Playwright qui photographient l'interface, et `build-assets.py` qui produit `ai-bridge.assets.js`.

## Refaire les captures puis le film

```bash
# 1. Construire le site et capturer l'interface (Playwright requis)
cd intake-agent && node build.mjs && cd ../video/capture
mkdir -p shots
node 1-intake.mjs shots && node 2-file-dsi.mjs shots && node 3-messagerie-feuille-de-route.mjs shots
python3 build-assets.py shots          # Pillow requis

# 2. Rendre avec le moteur motion-design-studio (dossier STUDIO = copie de engine/)
cp ../film/ai-bridge.html ../film/ai-bridge.assets.js $STUDIO/films/
cp ../film/brand.css $STUDIO/fonts/
cd $STUDIO
node scripts/check.mjs films/ai-bridge.html --size 1920x1080
node scripts/render.mjs films/ai-bridge.html --stills --size 1920x1080   # planche de contrôle
node scripts/render.mjs films/ai-bridge.html --size 1920x1080            # out/ai-bridge/final-1920x1080.mp4
```
