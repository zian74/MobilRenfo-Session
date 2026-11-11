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
- Calendrier semaine et mois : planification d'une session (ou séance libre) à une date/heure, récurrence (quotidienne / hebdomadaire), glisser-déplacer d'un jour à l'autre, code couleur par type, modification / suppression.
- Marquage « effectuée » avec bilan par exercice (séries / répétitions / charge réalisées, sensation, commentaire).
- Historique filtrable (période, type, groupe musculaire) et statistiques (séances par semaine, volume total séries × répétitions × charge, répartition renforcement/mobilité).
- Responsive mobile / desktop, navigation clavier, labels ARIA, contraste AA.

## Tests

`npm test` couvre les parcours critiques : auth (register/login/logout/erreurs), 401 sans session, CRUD exercices + filtres + isolation entre utilisateurs, création/réordonnancement/duplication de sessions, planification + récurrence + déplacement + bilan, historique + stats, export/suppression RGPD, refus des mutations cross-origin.

## Hors périmètre MVP (V2 du CdC)

Partage de sessions par lien, PWA hors ligne, rappels/notifications, import de données, espace coach/athlète, stockage média S3. Le schéma SQL est prêt à évoluer vers PostgreSQL + Prisma si besoin.
