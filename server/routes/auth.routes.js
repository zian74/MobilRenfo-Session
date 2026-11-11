import { Router } from 'express';
import { getDb } from '../db.js';
import { deleteAllMediaForUser } from '../media.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, currentUser,
  requireAuth, validateEmail, validatePassword, str, oneOf, strArray,
  ValidationError, apiError,
} from '../auth.js';

const router = Router();

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, niveau: u.niveau, objectifs: u.objectifs, createdAt: u.createdAt };
}

router.post('/register', (req, res) => {
  try {
    const email = str(req.body?.email, { max: 254, required: true }).toLowerCase();
    const password = req.body?.password;
    const name = str(req.body?.name, { max: 100 });
    if (!validateEmail(email)) throw new ValidationError('Email invalide');
    if (!validatePassword(password)) throw new ValidationError('Mot de passe invalide (8 caractères minimum)');
    const niveau = oneOf(str(req.body?.niveau, { max: 30 }), ['débutant', 'intermédiaire', 'avancé'], 'débutant');
    const objectifs = strArray(req.body?.objectifs, { maxItems: 10, maxLen: 40 });
    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return apiError(res, 409, 'Un compte existe déjà avec cet email');
    const info = db
      .prepare('INSERT INTO users (email, password_hash, name, niveau, objectifs) VALUES (?, ?, ?, ?, ?)')
      .run(email, hashPassword(password), name, niveau, JSON.stringify(objectifs));
    createSession(res, info.lastInsertRowid);
    const user = currentUser(req) || { id: info.lastInsertRowid, email, name, niveau, objectifs };
    res.status(201).json({ user: publicUser(user) });
  } catch (e) {
    if (e instanceof ValidationError) return apiError(res, 400, e.message);
    throw e;
  }
});

router.post('/login', (req, res) => {
  try {
    const email = str(req.body?.email, { max: 254, required: true }).toLowerCase();
    const password = req.body?.password;
    if (!validatePassword(password)) throw new ValidationError('Mot de passe invalide');
    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!row || !verifyPassword(String(password), row.password_hash)) {
      return apiError(res, 401, 'Identifiants incorrects');
    }
    createSession(res, row.id);
    res.json({ user: publicUser({ id: row.id, email: row.email, name: row.name, niveau: row.niveau, objectifs: JSON.parse(row.objectifs || '[]'), createdAt: row.created_at }) });
  } catch (e) {
    if (e instanceof ValidationError) return apiError(res, 400, e.message);
    throw e;
  }
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.put('/me', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const name = str(req.body?.name, { max: 100 });
    const niveau = oneOf(str(req.body?.niveau, { max: 30 }), ['débutant', 'intermédiaire', 'avancé'], 'débutant');
    const objectifs = strArray(req.body?.objectifs, { maxItems: 10, maxLen: 40 });
    db.prepare("UPDATE users SET name = ?, niveau = ?, objectifs = ?, updated_at = datetime('now') WHERE id = ?")
      .run(name, niveau, JSON.stringify(objectifs), req.user.id);
    res.json({ user: publicUser({ ...req.user, name, niveau, objectifs }) });
  } catch (e) {
    if (e instanceof ValidationError) return apiError(res, 400, e.message);
    throw e;
  }
});

router.get('/me/export', requireAuth, (req, res) => {
  const db = getDb();
  const uid = req.user.id;
  const exercises = db.prepare('SELECT * FROM exercises WHERE user_id = ? ORDER BY id').all(uid).map((r) => ({ ...r, equipement: JSON.parse(r.equipement), tags: JSON.parse(r.tags) }));
  const sessions = db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY id').all(uid);
  const sessionExercises = db.prepare(
    'SELECT se.* FROM session_exercises se JOIN sessions s ON s.id = se.session_id WHERE s.user_id = ? ORDER BY se.session_id, se.ordre'
  ).all(uid);
  const planned = db.prepare('SELECT * FROM planned_sessions WHERE user_id = ? ORDER BY date').all(uid);
  const logs = db.prepare(
    'SELECT l.* FROM session_logs l JOIN planned_sessions p ON p.id = l.planned_session_id WHERE p.user_id = ? ORDER BY l.id'
  ).all(uid);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mobilrenfo-export.json"');
  res.json({
    exportedAt: new Date().toISOString(),
    user: { email: req.user.email, name: req.user.name, niveau: req.user.niveau, objectifs: req.user.objectifs },
    exercises, sessions, sessionExercises, plannedSessions: planned, sessionLogs: logs,
  });
});

router.delete('/me', requireAuth, (req, res) => {
  const db = getDb();
  deleteAllMediaForUser(req.user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  destroySession(req, res);
  res.json({ ok: true });
});

export default router;
