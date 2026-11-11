import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  niveau TEXT NOT NULL DEFAULT 'débutant' CHECK (niveau IN ('débutant','intermédiaire','avancé')),
  objectifs TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  categorie TEXT NOT NULL CHECK (categorie IN ('renforcement','mobilité')),
  groupe_musculaire TEXT NOT NULL DEFAULT '',
  niveau TEXT NOT NULL DEFAULT 'débutant' CHECK (niveau IN ('débutant','intermédiaire','avancé')),
  equipement TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  media_url TEXT NOT NULL DEFAULT '',
  series_defaut INTEGER,
  repetitions_defaut INTEGER,
  temps_travail_defaut INTEGER,
  repos_defaut INTEGER,
  charge_conseille TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  favori INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exercises_user ON exercises(user_id);
CREATE INDEX IF NOT EXISTS idx_exercises_nom ON exercises(user_id, nom);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'mixte' CHECK (type IN ('renforcement','mobilité','mixte')),
  duree_estimee INTEGER,
  echauffement TEXT NOT NULL DEFAULT '',
  retour_au_calme TEXT NOT NULL DEFAULT '',
  partage TEXT NOT NULL DEFAULT 'privée' CHECK (partage IN ('privée','lien')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS session_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  exercise_id INTEGER REFERENCES exercises(id) ON DELETE SET NULL,
  ordre INTEGER NOT NULL,
  nom_libre TEXT NOT NULL DEFAULT '',
  series INTEGER,
  repetitions INTEGER,
  temps_travail INTEGER,
  repos INTEGER,
  charge TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_session_exercises_session ON session_exercises(session_id, ordre);

CREATE TABLE IF NOT EXISTS planned_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  titre_libre TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  heure TEXT,
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','daily','weekly','custom')),
  jours TEXT NOT NULL DEFAULT '[]',
  fin_recurrence TEXT,
  couleur TEXT NOT NULL DEFAULT '',
  effectuee INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media (
  key TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id);
CREATE INDEX IF NOT EXISTS idx_planned_user_date ON planned_sessions(user_id, date);

CREATE TABLE IF NOT EXISTS session_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  planned_session_id INTEGER NOT NULL REFERENCES planned_sessions(id) ON DELETE CASCADE,
  session_exercise_id INTEGER REFERENCES session_exercises(id) ON DELETE SET NULL,
  exercice TEXT NOT NULL DEFAULT '',
  series_realisees INTEGER,
  repetitions_realisees INTEGER,
  charge_utilisee TEXT NOT NULL DEFAULT '',
  sensation TEXT NOT NULL DEFAULT '',
  commentaire TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_planned ON session_logs(planned_session_id);
`;

db.exec(schema);

function migrate() {
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'planned_sessions'").get();
  const oldCheck = info && info.sql && info.sql.includes("'none','daily','weekly'") && !info.sql.includes("'custom'");
  if (oldCheck) {
    db.exec(`
      ALTER TABLE planned_sessions RENAME TO planned_sessions_old;
      CREATE TABLE planned_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
        titre_libre TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        heure TEXT,
        recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','daily','weekly','custom')),
        jours TEXT NOT NULL DEFAULT '[]',
        fin_recurrence TEXT,
        couleur TEXT NOT NULL DEFAULT '',
        effectuee INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO planned_sessions (id, user_id, session_id, titre_libre, date, heure, recurrence, couleur, effectuee, notes, created_at, updated_at)
        SELECT id, user_id, session_id, titre_libre, date, heure, recurrence, couleur, effectuee, notes, created_at, updated_at FROM planned_sessions_old;
      DROP TABLE planned_sessions_old;
      CREATE INDEX IF NOT EXISTS idx_planned_user_date ON planned_sessions(user_id, date);
    `);
  }
  const cols = db.prepare('PRAGMA table_info(planned_sessions)').all().map((c) => c.name);
  if (!cols.includes('jours')) {
    db.exec("ALTER TABLE planned_sessions ADD COLUMN jours TEXT NOT NULL DEFAULT '[]'");
  }
  if (!cols.includes('fin_recurrence')) {
    db.exec('ALTER TABLE planned_sessions ADD COLUMN fin_recurrence TEXT');
  }
  const mediaInfo = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'media'").get();
  if (!mediaInfo) {
    db.exec(`CREATE TABLE IF NOT EXISTS media (
      key TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id);`);
  }
}
migrate();

export function getDb() {
  return db;
}

export function dbPath() {
  return DB_PATH;
}
