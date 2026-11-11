import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth, str, oneOf, ValidationError, apiError } from '../auth.js';

const router = Router();
router.use(requireAuth);

const RECURRENCES = ['none', 'daily', 'weekly'];
const TYPE_COLORS = { renforcement: '#e05252', mobilité: '#3d9970', mixte: '#3b6fd4', libre: '#8a8f98' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseRow(row, sessionById) {
  const session = row.session_id && sessionById ? sessionById.get(row.session_id) : null;
  return {
    ...row,
    effectuee: !!row.effectuee,
    couleur: row.couleur || (session ? TYPE_COLORS[session.type] || TYPE_COLORS.libre : TYPE_COLORS.libre),
    session_nom: session ? session.nom : '',
    session_type: session ? session.type : 'libre',
  };
}

router.get('/', (req, res) => {
  const db = getDb();
  const from = str(req.query.from, { max: 10 });
  const to = str(req.query.to, { max: 10 });
  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    return apiError(res, 400, 'Plage de dates invalide (from/to au format AAAA-MM-JJ)');
  }
  const rows = db
    .prepare('SELECT * FROM planned_sessions WHERE user_id = ? ORDER BY date, heure, id')
    .all(req.user.id);
  const sessions = db
    .prepare('SELECT id, nom, type FROM sessions WHERE user_id = ?')
    .all(req.user.id);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const occurrences = [];
  for (const row of rows) {
    if (row.recurrence === 'none') {
      if (row.date >= from && row.date <= to) {
        occurrences.push({ ...parseRow(row, sessionById), occurrenceDate: row.date });
      }
      continue;
    }
    let cursor = row.date > from ? row.date : from;
    if (row.recurrence === 'weekly') {
      const targetDow = new Date(`${row.date}T00:00:00Z`).getUTCDay();
      const startDow = new Date(`${cursor}T00:00:00Z`).getUTCDay();
      let delta = (targetDow - startDow + 7) % 7;
      cursor = addDays(cursor, delta);
    }
    while (cursor <= to) {
      if (cursor >= row.date) {
        occurrences.push({ ...parseRow(row, sessionById), occurrenceDate: cursor });
      }
      cursor = addDays(cursor, row.recurrence === 'daily' ? 1 : 7);
    }
  }
  occurrences.sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate) || (a.heure || '').localeCompare(b.heure || ''));
  res.json({ planned: occurrences });
});

function readPlannedBody(req, body, { partial = false } = {}) {
  const out = {};
  if (!partial || 'session_id' in (body ?? {})) {
    const sid = body?.session_id;
    out.session_id = sid === undefined || sid === null || sid === '' ? null : Number(sid);
    if (out.session_id !== null && !Number.isInteger(out.session_id)) {
      throw new ValidationError('session_id invalide');
    }
  }
  if (!partial || 'titre_libre' in (body ?? {})) out.titre_libre = str(body?.titre_libre, { max: 120 });
  if (!partial || 'date' in (body ?? {})) {
    out.date = str(body?.date, { max: 10, required: true });
    if (!isValidDate(out.date)) throw new ValidationError('Date invalide (AAAA-MM-JJ)');
  }
  if (!partial || 'heure' in (body ?? {})) {
    const h = body?.heure;
    out.heure = h === undefined || h === null || h === '' ? null : str(h, { max: 5 });
    if (out.heure !== null && !HEURE_RE.test(out.heure)) throw new ValidationError('Heure invalide (HH:MM)');
  }
  if (!partial || 'recurrence' in (body ?? {})) {
    out.recurrence = oneOf(str(body?.recurrence, { max: 10 }), RECURRENCES, 'none');
  }
  if (!partial || 'couleur' in (body ?? {})) out.couleur = str(body?.couleur, { max: 20 });
  if (!partial || 'notes' in (body ?? {})) out.notes = str(body?.notes, { max: 2000 });
  if ('effectuee' in (body ?? {})) out.effectuee = body?.effectuee ? 1 : 0;
  return out;
}

function resolveColor(db, userId, sessionId, couleur) {
  if (couleur) return couleur;
  if (sessionId == null) return TYPE_COLORS.libre;
  const s = db.prepare('SELECT type FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  return s ? TYPE_COLORS[s.type] || TYPE_COLORS.libre : TYPE_COLORS.libre;
}

function ownPlanned(req, res, id) {
  const row = getDb().prepare('SELECT * FROM planned_sessions WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!row) {
    apiError(res, 404, 'Planification introuvable');
    return null;
  }
  return row;
}

function validateSessionRef(db, userId, sessionId) {
  if (sessionId == null) return true;
  return !!db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
}

router.post('/', (req, res) => {
  try {
    const db = getDb();
    const data = readPlannedBody(req, req.body);
    if (!validateSessionRef(db, req.user.id, data.session_id)) {
      throw new ValidationError('Session associée introuvable');
    }
    if (data.session_id == null && !data.titre_libre) {
      throw new ValidationError('Indiquez une session ou un titre libre');
    }
    const couleur = resolveColor(db, req.user.id, data.session_id, data.couleur);
    const info = db.prepare(
      `INSERT INTO planned_sessions (user_id, session_id, titre_libre, date, heure, recurrence, couleur, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.user.id, data.session_id, data.titre_libre, data.date, data.heure, data.recurrence, couleur, data.notes || '');
    const row = db.prepare('SELECT * FROM planned_sessions WHERE id = ?').get(info.lastInsertRowid);
    const sessions = db.prepare('SELECT id, nom, type FROM sessions WHERE user_id = ?').all(req.user.id);
    res.status(201).json({ planned: parseRow(row, new Map(sessions.map((s) => [s.id, s]))) });
  } catch (e) {
    if (e instanceof ValidationError) return apiError(res, 400, e.message);
    throw e;
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = getDb();
    const existing = ownPlanned(req, res, id);
    if (!existing) return;
    const data = readPlannedBody(req, req.body, { partial: true });
    const merged = {
      session_id: 'session_id' in data ? data.session_id : existing.session_id,
      titre_libre: 'titre_libre' in data ? data.titre_libre : existing.titre_libre,
      date: 'date' in data ? data.date : existing.date,
      heure: 'heure' in data ? data.heure : existing.heure,
      recurrence: 'recurrence' in data ? data.recurrence : existing.recurrence,
      couleur: 'couleur' in data ? data.couleur : existing.couleur,
      notes: 'notes' in data ? data.notes : existing.notes,
      effectuee: 'effectuee' in data ? data.effectuee : existing.effectuee,
    };
    if (!validateSessionRef(db, req.user.id, merged.session_id)) {
      throw new ValidationError('Session associée introuvable');
    }
    if (merged.session_id == null && !merged.titre_libre) {
      throw new ValidationError('Indiquez une session ou un titre libre');
    }
    const couleur = resolveColor(db, req.user.id, merged.session_id, merged.couleur);
    db.prepare(
      `UPDATE planned_sessions SET session_id = ?, titre_libre = ?, date = ?, heure = ?, recurrence = ?,
        couleur = ?, notes = ?, effectuee = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
    ).run(merged.session_id, merged.titre_libre, merged.date, merged.heure, merged.recurrence, couleur, merged.notes, merged.effectuee, id, req.user.id);
    const row = db.prepare('SELECT * FROM planned_sessions WHERE id = ?').get(id);
    const sessions = db.prepare('SELECT id, nom, type FROM sessions WHERE user_id = ?').all(req.user.id);
    res.json({ planned: parseRow(row, new Map(sessions.map((s) => [s.id, s]))) });
  } catch (e) {
    if (e instanceof ValidationError) return apiError(res, 400, e.message);
    throw e;
  }
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const info = getDb().prepare('DELETE FROM planned_sessions WHERE id = ? AND user_id = ?').run(id, req.user.id);
  if (info.changes === 0) return apiError(res, 404, 'Planification introuvable');
  res.json({ ok: true });
});

export default router;
