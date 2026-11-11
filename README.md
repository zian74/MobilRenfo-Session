# MobilRenfo-Session

Webapp de création de fiches d'exercices, de fiches de session et de planification de séances de renforcement musculaire et de travail de la mobilité (MVP du cahier des charges).

## Démarrage

```bash
npm install
npm start          # http://127.0.0.1:3000
npm test           # tests API automatisés (node:test)
npm run dev        # rechargement auto (node --watch)
```

Variables d'environnement : `PORT` (défaut 3000), `HOST` (défaut 127.0.0.1), `DB_PATH` (défaut `data/app.db`).

## Architecture

- **Back** : Node.js + Express, base SQLite (`better-sqlite3`) — schéma conforme au modèle du CdC §4 (`users`, `exercises`, `sessions`, `session_exercises`, `planned_sessions`, `session_logs`). Auth par session en cookie httpOnly (glissement 30 jours), mots de passe hachés avec **scrypt** (`node:crypto`). Toutes les requêtes sont scopées par `user_id` (isolation stricte des données). Protection CSRF : cookie `SameSite=Lax` + contrôle de l'en-tête `Origin` + `Content-Type: application/json` exigé sur les mutations. Validation stricte de toutes les entrées.
- **Front** : SPA en JavaScript vanilla (ES modules, sans build), routage par hash, servie par Express. Vues : connexion/inscription, bibliothèque d'exercices, fiches de session, calendrier, historique, profil.

## Fonctionnalités MVP (CdC §9)

- Compte email + mot de passe (scrypt), profil (nom, niveau, objectifs), export JSON des données et suppression de compte (RGPD).
- CRUD exercices avec recherche plein texte (< 300 ms côté serveur), filtres (catégorie, groupe musculaire, équipement, niveau, favori), tri, duplication, favori.
- Fiches de session : assemblage d'exercices depuis la bibliothèque (recherche), paramètres surchargeables par exercice, réordonnancement par glisser-déposer (et boutons ↑↓), blocs libres, échauffement / retour au calme, durée estimée auto, mode lecture plein écran / imprimable.
- **Session en direct** : bouton « ▶ Démarrer » (liste des sessions ou mode lecture, route `#/sessions/:id/demarrer`) → enchaînement automatique série par série (chrono du temps de travail, puis chrono du temps de repos, puis série suivante).
- **Exercice en direct** : bouton « ▶ Démarrer l’exercice » sur la fiche exercice (route `#/exercices/:id/demarrer`) → **compte à rebours de 10 s avant le début de l’exercice**, puis séries travail/repos selon les paramètres par défaut de l’exercice. Le chrono de travail porte sur **toute la série** : `temps_travail` secondes par série (3 s/rép estimées quand seul le nombre de répétitions est renseigné, comme pour la durée estimée — marqué « estimé » à l'écran). L'écran affiche l'exercice en cours, le n° de série et le nombre de répétitions ; un signal sonore distinct (WebAudio) marque la fin de chaque exercice, un autre la fin de la séance. Pause / passer une série / passer un exercice / quitter disponibles.
- Calendrier semaine et mois : planification d'une session (ou séance libre) à une date/heure, récurrence (quotidienne / hebdomadaire), glisser-déplacer d'un jour à l'autre, code couleur par type, modification / suppression.
- Marquage « effectuée » avec bilan par exercice (séries / répétitions / charge réalisées, sensation, commentaire).
- Historique filtrable (période, type, groupe musculaire) et statistiques (séances par semaine, volume total séries × répétitions × charge, répartition renforcement/mobilité).
- Responsive mobile / desktop, navigation clavier, labels ARIA, contraste AA.

## Tests

`npm test` couvre les parcours critiques : auth (register/login/logout/erreurs), 401 sans session, CRUD exercices + filtres + isolation entre utilisateurs, création/réordonnancement/duplication de sessions, planification + récurrence + déplacement + bilan, historique + stats, export/suppression RGPD, refus des mutations cross-origin — plus les apports V1.5 : récurrence personnalisée + fin, `GET /api/planned/:id` et isolement, upload/lecture/suppression de médias avec ACL, stats avancées (volume par semaine/groupe, progression, streak).

## V1.5 (CdC §8)

- **Récurrence avancée** : récurrence personnalisée par jours de la semaine (`custom` + `jours`) et date de fin de récurrence (`fin_recurrence`), en plus de « une fois / quotidienne / hebdomadaire ». Migration automatique des anciennes bases (reconstruction de `planned_sessions` si l'ancien CHECK est détecté).
- **Médias sur les exercices** : upload de fichiers image/vidéo (png, jpg, gif, webp, mp4, webm, mov — 25 Mo max) stockés sur disque (`data/uploads/u<id>/…`, `UPLOAD_DIR` configurable), servis en privé via `/api/media/<key>` avec contrôle d propriétaire, aperçus dans la bibliothèque et le formulaire, suppression du média liée à la suppression de l'exercice ou du compte. L'URL externe reste possible.
- **Mode « séance du jour »** : route `#/seance/:plannedId` — fiche en mode lecture (cases à cocher, plein écran, impression) avec bouton « Marquer effectuée + bilan » intégré (bilan par exercice : séries/répétitions/charge réalisées, sensation, commentaire).
- **Statistiques avancées** : volume par semaine et par groupe musculaire (barres), progression des charges par exercice, série de semaines consécutives, séances par mois — en plus des stats MVP.

## Version statique mono-utilisateur (GitHub Pages)

Le dossier **`docs/`** contient une version **100 % statique et mono-utilisateur** de l'app, publiée via GitHub Pages : **https://zian74.github.io/MobilRenfo-Session/**

Activation (1 fois, côté dépôt) : **Settings → Pages → Build and deployment → Source → « GitHub Actions »** (le workflow `.github/workflows/pages.yml` déploie `docs/` à chaque push sur `main`). Alternative : Source → « Deploy from a branch » → `main` → `/docs`.

- **Aucun compte, aucun serveur** : l'app s'ouvre directement (pas de connexion/inscription).
- **Données 100 % locales** : `localStorage` pour les données JSON, IndexedDB pour les médias (images/vidéos des exercices) — rien ne quitte votre navigateur.
- Toutes les fonctionnalités sont conservées : bibliothèque d'exercices (recherche/filtres/médias), fiches de session (glisser-déposer), calendrier semaine/mois (récurrences personnalisées + fin), mode « séance du jour » avec bilan, historique et statistiques avancées.
- Profil : export JSON des données, **import JSON**, et effacement complet depuis la page Profil.
- **PWA hors ligne** : `manifest.webmanifest` + icônes + `sw.js` (cache du shell applicatif, navigation offline) — installable et consultable hors ligne, les données étant déjà locales.
- **Rappels de séance** : champ « 🔔 Rappel » (minutes avant) sur chaque planification + scheduler de notifications (`js/notifications.js`), activation via le profil.
- **Partage de fiche par lien en lecture seule** : bouton « 🔗 Copier le lien de partage » en mode lecture → URL `#/partage/<base64url>` décodée côté client, sans serveur.
- **Fichier d'exemple** : `docs/exemple-exercices.json` (2 exercices de renforcement typiques : Squat, Développé couché) au format d'import/export — téléchargeable sur le site Pages (`/exemple-exercices.json`) et réimportable via Profil → « ⬆ Importer des données (JSON) ».
- L'API locale (`docs/js/api.js`) reprend la même surface que l'API serveur et est testée sous Node (`test/static.test.js`, `test/static-v2.test.js`, stockage mémoire de repli).

La version serveur (`server/` + `public/`) reste disponible pour un usage avec comptes, via `npm start`.

## Durcissement sécurité (avant prod)

- **En-têtes HTTP** sur toutes les réponses : CSP stricte (`default-src 'self'`, `script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`…), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy` (caméra/micro/GPS désactivés), et **HSTS** activé automatiquement en production/HTTPS.
- **Rate limiting** en mémoire (fenêtre glissante, `server/ratelimit.js`) : login 10/15 min/IP, inscription 5/15 min/IP, upload 20/h/utilisateur, API 600/5 min/utilisateur — réponse `429` + `Retry-After`. Limites surchargeables par variables `RATE_LIMIT_*`. En déploiement multi-instance, remplacer par un store partagé (Redis).
- **Révocation globale des sessions** : `DELETE /api/auth/sessions` + bouton « Déconnecter toutes les sessions » dans le profil.
- `npm audit` : 0 vulnérabilité. Nouveaux tests `test/security.test.js` : en-têtes HTTP, 429 login, 429 upload, logout-all.
- À faire côté infra avant mise en ligne : TLS en terminaison (HSTS alors actif), proxy inverse, sauvegardes quotidiennes de `data/app.db`.

## Hors périmètre (V2 du CdC)

Partage de sessions par lien, PWA hors ligne, rappels/notifications, import de données, espace coach/athlète, stockage média S3 (le stockage local uploadé peut être remplacé par un bucket S3 compatible). Le schéma SQL est prêt à évoluer vers PostgreSQL + Prisma si besoin.
