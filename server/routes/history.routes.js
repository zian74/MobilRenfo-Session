import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth, str, intOrNull, oneOf, ValidationError, apiError } from '../auth.js';

const router = Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SENSATIONS = ['facile', 'correct', 'difficile', 'très difficile'];

function validRange(req) {
  const from = req.query.from ? str(req.query.from, { max: 10 }) : null;
  const to = req.query.to ? str(req.query.to, { max: 10 }) : null;
  for (const d of [from, to]) {
    if (d && (!DATE_RE.test(d) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d)) return null;
  }
  if (from && to && from > to) return null;
  return { from, to };
}

function logsFor(db, plannedId) {
  return db.prepare('SELECT * FROM session_logs WHERE planned_session_id = ? ORDER BY id').all(plannedId);
}

function historyRow(db, row) {
  const session = row.session_id
    ? db.prepare('SELECT id, nom, type, duree_estimee FROM sessions WHERE id = ?').get(row.session_id)
    : null;
  return {
    id: row.id,
    date: row.date,
    heure: row.heure,
    titre: session ? session.nom : row.titre_libre,
    session_id: row.session_id,
    type: session ? session.type : 'libre',
    duree_estimee: session?.duree_estimee ?? null,
    couleur: row.couleur,
    notes: row.notes,
    recurrence: row.recurrence,
    logs: logsFor(db, row.id),
  };
}

router.post('/planned/:id/logs', (req, res) => {
  const plannedId = Number(req.params.id);
  const db = getDb();
  const planned = db.prepare('SELECT * FROM planned_sessions WHERE id = ? AND user_id = ?').get(plannedId, req.user.id);
  if (!planned) return apiError(res, 404, 'Planification introuvable');
  try {
    const body = req.body ?? {};
    const logs = Array.isArray(body.logs) ? body.logs.slice(0, 200) : [];
    const validItemIds = new Set(
      planned.session_id
        ? db.prepare('SELECT id FROM session_exercises WHERE session_id = ?').all(planned.session_id).map((r) => r.id)
        : []
    );
    const parsed = logs.map((l) => ({
      session_exercise_id: l?.session_exercise_id != null && validItemIds.has(Number(l.session_exercise_id)) ? Number(l.session_exercise_id) : null,
      exercice: str(l?.exercice, { max: 120, required: true }),
      series_realisees: intOrNull(l?.series_realisees, { min: 0, max: 1000 }),
      repetitions_realisees: intOrNull(l?.repetitions_realisees, { min: 0, max: 10000 }),
      charge_utilisee: str(l?.charge_utilisee, { max: 60 }),
      sensation: oneOf(str(l?.sensation, { max: 30 }), [...SENSATIONS, ''], ''),
      commentaire: str(l?.commentaire, { max: 1000 }),
    }));
    const markDone = body.marquer_effectuee !== false;
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM session_logs WHERE planned_session_id = ?').run(plannedId);
      const ins = db.prepare(
        `INSERT INTO session_logs (planned_session_id, session_exercise_id, exercice, series_realisees, repetitions_realisees, charge_utilisee, sensation, commentaire)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const l of parsed) {
        ins.run(plannedId, l.session_exercise_id, l.exercice, l.series_realisees, l.repetitions_realisees, l.charge_utilisee, l.sensation, l.commentaire);
      }
      if (typeof body.notes === 'string') {
        db.prepare("UPDATE planned_sessions SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(str(body.notes, { max: 2000 }), plannedId);
      }
      if (markDone) {
        db.prepare("UPDATE planned_sessions SET effectuee = 1, updated_at = datetime('now') WHERE id = ?").run(plannedId);
      }
    });
    tx();
    const row = db.prepare('SELECT * FROM planned_sessions WHERE id = ?').get(plannedId);
    res.json({ planned: { ...row, effectuee: !!row.effectuee, logs: logsFor(db, plannedId) } });
  } catch (e) {
    if (e instanceof ValidationError) return apiError(res, 400, e.message);
    throw e;
  }
});

router.get('/history', (req, res) => {
  const range = validRange(req);
  if (!range) return apiError(res, 400, 'Plage de dates invalide');
  const db = getDb();
  const params = [req.user.id];
  let where = 'p.user_id = ? AND p.effectuee = 1';
  if (range.from) { where += ' AND p.date >= ?'; params.push(range.from); }
  if (range.to) { where += ' AND p.date <= ?'; params.push(range.to); }
  const type = str(req.query.type, { max: 20 });
  if (type) {
    if (type === 'libre') where += ' AND p.session_id IS NULL';
    else where += ' AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = p.session_id AND s.type = ?)';
    params.push(type);
  }
  const groupe = str(req.query.groupe, { max: 80 });
  if (groupe) {
    where += ` AND EXISTS (
      SELECT 1 FROM sessions s JOIN session_exercises se ON se.session_id = s.id
      JOIN exercises e ON e.id = se.exercise_id
      WHERE s.id = p.session_id AND e.groupe_musculaire = ?)`;
    params.push(groupe);
  }
  const rows = db
    .prepare(`SELECT p.* FROM planned_sessions p WHERE ${where} ORDER BY p.date DESC, p.heure DESC, p.id DESC`)
    .all(...params);
  res.json({ history: rows.map((r) => historyRow(db, r)) });
});

router.get('/stats', (req, res) => {
  const range = validRange(req);
  if (!range) return apiError(res, 400, 'Plage de dates invalide');
  const db = getDb();
  const params = [req.user.id];
  let where = 'p.user_id = ? AND p.effectuee = 1';
  if (range.from) { where += ' AND p.date >= ?'; params.push(range.from); }
  if (range.to) { where += ' AND p.date <= ?'; params.push(range.to); }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM planned_sessions p WHERE ${where}`).get(...params).n;

  const perWeek = db
    .prepare(
      `SELECT strftime('%Y-%W', p.date) AS semaine, COUNT(*) AS n
       FROM planned_sessions p WHERE ${where} GROUP BY semaine ORDER BY semaine`
    )
    .all(...params);

  const perMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', p.date) AS mois, COUNT(*) AS n
       FROM planned_sessions p WHERE ${where} GROUP BY mois ORDER BY mois`
    )
    .all(...params);

  const repartition = db
    .prepare(
      `SELECT COALESCE(s.type, 'libre') AS type, COUNT(*) AS n
       FROM planned_sessions p LEFT JOIN sessions s ON s.id = p.session_id
       WHERE ${where} GROUP BY type`
    )
    .all(...params);

  const logRows = db
    .prepare(
      `SELECT l.series_realisees, l.repetitions_realisees, l.charge_utilisee, l.exercice,
              p.date AS date, e.groupe_musculaire AS groupe
       FROM session_logs l
       JOIN planned_sessions p ON p.id = l.planned_session_id
       LEFT JOIN session_exercises se ON se.id = l.session_exercise_id
       LEFT JOIN exercises e ON e.id = se.exercise_id
       WHERE ${where}`
    )
    .all(...params);

  const parseCharge = (txt) => {
    const m = /(\d+(?:[.,]\d+)?)/.exec(txt || '');
    return m ? parseFloat(m[1].replace(',', '.')) : 0;
  };
  const weekOf = (dateStr) => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
  };

  let volume = 0;
  let repsTotal = 0;
  const volumeParSemaine = new Map();
  const volumeParGroupe = new Map();
  const progression = new Map();
  for (const l of logRows) {
    const s = l.series_realisees || 0;
    const r = l.repetitions_realisees || 0;
    const charge = parseCharge(l.charge_utilisee);
    const v = s * r * charge;
    repsTotal += s * r;
    volume += v;
    const wk = weekOf(l.date);
    volumeParSemaine.set(wk, (volumeParSemaine.get(wk) || 0) + v);
    if (l.groupe) volumeParGroupe.set(l.groupe, (volumeParGroupe.get(l.groupe) || 0) + v);
    if (charge > 0 && l.exercice) {
      if (!progression.has(l.exercice)) progression.set(l.exercice, new Map());
      const byWeek = progression.get(l.exercice);
      byWeek.set(wk, Math.max(byWeek.get(wk) || 0, charge));
    }
  }

  const groupes = db
    .prepare(
      `SELECT e.groupe_musculaire AS groupe, COUNT(DISTINCT p.id) AS n
       FROM planned_sessions p
       JOIN sessions s ON s.id = p.session_id
       JOIN session_exercises se ON se.session_id = s.id
       JOIN exercises e ON e.id = se.exercise_id
       WHERE ${where} AND e.groupe_musculaire != '' GROUP BY e.groupe_musculaire ORDER BY n DESC`
    )
    .all(...params);

  const progressionParExercice = [...progression.entries()]
    .map(([exercice, byWeek]) => ({
      exercice,
      points: [...byWeek.entries()].map(([semaine, chargeMax]) => ({ semaine, chargeMax })).sort((a, b) => a.semaine.localeCompare(b.semaine)),
    }))
    .sort((a, b) => a.exercice.localeCompare(b.exercice));

  const weekIndex = (wk) => {
    const [y, w] = wk.split('-').map(Number);
    return y * 53 + w;
  };
  let streakSemaines = 0;
  if (perWeek.length) {
    const weeks = perWeek.map((r) => weekIndex(r.semaine)).sort((a, b) => b - a);
    let expected = weeks[0];
    for (const w of weeks) {
      if (w === expected) { streakSemaines++; expected--; }
      else break;
    }
  }

  res.json({
    stats: {
      totalSeances: total,
      parSemaine: perWeek,
      parMois: perMonth,
      repartition,
      volumeTotal: Math.round(volume * 10) / 10,
      repetitionsTotales: repsTotal,
      parGroupeMusculaire: groupes,
      volumeParSemaine: [...volumeParSemaine.entries()].map(([semaine, volume]) => ({ semaine, volume: Math.round(volume * 10) / 10 })).sort((a, b) => a.semaine.localeCompare(b.semaine)),
      volumeParGroupe: [...volumeParGroupe.entries()].map(([groupe, volume]) => ({ groupe, volume: Math.round(volume * 10) / 10 })).sort((a, b) => b.volume - a.volume),
      progressionParExercice,
      streakSemaines,
    },
  });
});

export default router;
