import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth, str, intOrNull, oneOf, ValidationError, apiError } from '../auth.js';

const router = Router();
router.use(requireAuth);

const TYPES = ['renforcement', 'mobilité', 'mixte'];

function parseSession(row) {
  return { ...row, effectueeCount: undefined };
}

function sessionWithExercises(db, id, userId) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(id, userId);
  if (!session) return null;
  const items = db
    .prepare(
      `SELECT se.*, e.nom AS exercise_nom, e.categorie AS exercise_categorie, e.groupe_musculaire AS exercise_groupe,
              e.niveau AS exercise_niveau, e.equipement AS exercise_equipement,
              e.series_defaut AS exercise_series_defaut, e.repetitions_defaut AS exercise_repetitions_defaut,
              e.temps_travail_defaut AS exercise_temps_travail_defaut, e.repos_defaut AS exercise_repos_defaut,
              e.charge_conseille AS exercise_charge_conseille
       FROM session_exercises se
       LEFT JOIN exercises e ON e.id = se.exercise_id
       WHERE se.session_id = ? ORDER BY se.ordre ASC, se.id ASC`
    )
    .all(id);
  return {
    ...session,
    items: items.map((it) => ({
      ...it,
      exercise_equipement: it.exercise_equipement ? JSON.parse(it.exercise_equipement) : [],
    })),
  };
}

function readSessionBody(body) {
  const items = Array.isArray(body?.items) ? body.items.slice(0, 100) : [];
  return {
    nom: str(body?.nom, { max: 120, required: true }),
    description: str(body?.description, { max: 2000 }),
    type: oneOf(str(body?.type, { max: 20 }), TYPES, 'mixte'),
    duree_estimee: intOrNull(body?.duree_estimee, { min: 0, max: 24 * 60 }),
    echauffement: str(body?.echauffement, { max: 1000 }),
    retour_au_calme: str(body?.retour_au_calme, { max: 1000 }),
    partage: oneOf(str(body?.partage, { max: 20 }), ['privée', 'lien'], 'privée'),
    items: items.map((it) => ({
      exercise_id: it.exercise_id != null ? Number(it.exercise_id) : null,
      nom_libre: str(it?.nom_libre, { max: 120 }),
      series: intOrNull(it?.series, { min: 0, max: 1000 }),
      repetitions: intOrNull(it?.repetitions, { min: 0, max: 10000 }),
      temps_travail: intOrNull(it?.temps_travail, { min: 0, max: 36000 }),
      repos: intOrNull(it?.repos, { min: 0, max: 36000 }),
      charge: str(it?.charge, { max: 60 }),
      notes: str(it?.notes, { max: 1000 }),
    })),
  };
}

function saveItems(db, sessionId, userId, items) {
  db.prepare('DELETE FROM session_exercises WHERE session_id = ?').run(sessionId);
  const insert = db.prepare(
    `INSERT INTO session_exercises (session_id, exercise_id, ordre, nom_libre, series, repetitions, temps_travail, repos, charge, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const checkExercise = db.prepare('SELECT id FROM exercises WHERE id = ? AND user_id = ?');
  const tx = db.transaction(() => {
    items.forEach((it, idx) => {
      let exerciseId = it.exercise_id;
      if (exerciseId != null) {
        if (!checkExercise.get(exerciseId, userId)) exerciseId = null;
      }
      insert.run(sessionId, exerciseId, idx, it.nom_libre, it.series, it.repetitions, it.temps_travail, it.repos, it.charge, it.notes);
    });
  });
  tx();
}

function resolveItemDefaults(db, userId, it) {
  const ex = it.exercise_id
    ? db.prepare('SELECT series_defaut, repetitions_defaut, temps_travail_defaut, repos_defaut, charge_conseille FROM exercises WHERE id = ? AND user_id = ?').get(it.exercise_id, userId)
    : null;
  return {
    ...it,
    series: it.series ?? ex?.series_defaut ?? null,
    repetitions: it.repetitions ?? ex?.repetitions_defaut ?? null,
    temps_travail: it.temps_travail ?? ex?.temps_travail_defaut ?? null,
    repos: it.repos ?? ex?.repos_defaut ?? null,
    charge: it.charge || ex?.charge_conseille || '',
  };
}

function estimatedDuration(items) {
  let total = 0;
  for (const it of items) {
    const series = it.series || 0;
    const reps = it.repetitions || 0;
    const temps = it.temps_travail || 0;
    const repos = it.repos || 0;
    if (series > 0 && (reps > 0 || temps > 0)) {
      total += series * (temps > 0 ? temps : reps * 3) + Math.max(0, series - 1) * repos;
    } else if (temps > 0) {
      total += temps;
    }
  }
  return Math.round(total / 60);
}

router.get('/', (req, res) => {
  const db = getDb();
  const q = str(req.query.q, { max: 100 });
  const params = [req.user.id];
  let where = 'user_id = ?';
  if (q) {
    where += ' AND (nom LIKE ? OR description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (req.query.type && TYPES.includes(req.query.type)) {
    where += ' AND type = ?';
    params.push(req.query.type);
  }
  const rows = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM session_exercises se WHERE se.session_id = s.id) AS nb_exercices
       FROM sessions s WHERE ${where} ORDER BY s.updated_at DESC, s.id DESC`
    )
    .all(...params);
  res.json({ sessions: rows.map(parseSession) });
});

router.get('/:id', (req, res) => {
  const session = sessionWithExercises(getDb(), Number(req.params.id), req.user.id);
  if (!session) return apiError(res, 404, 'Session introuvable');
  res.json({ session });
});

router.post('/', (req, res) => {
  try {
    const data = readSessionBody(req.body);
    const db = getDb();
    const duree = data.duree_estimee ?? estimatedDuration(data.items.map((it) => resolveItemDefaults(db, req.user.id, it)));
    const info = db.prepare(
      `INSERT INTO sessions (user_id, nom, description, type, duree_estimee, echauffement, retour_au_calme, partage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.user.id, data.nom, data.description, data.type, duree, data.echauffement, data.retour_au_calme, data.partage);
    const sessionId = info.lastInsertRowid;
    saveItems(db, sessionId, req.user.id, data.items);
    res.status(201).json({ session: sessionWithExercises(db, sessionId, req.user.id) });
  } catch (e) {
    if (e instanceof ValidationError) return apiError(res, 400, e.message);
    throw e;
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = getDb();
    if (!db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(id, req.user.id)) {
      return apiError(res, 404, 'Session introuvable');
    }
    const data = readSessionBody(req.body);
    const duree = data.duree_estimee ?? estimatedDuration(data.items.map((it) => resolveItemDefaults(db, req.user.id, it)));
    db.prepare(
      `UPDATE sessions SET nom = ?, description = ?, type = ?, duree_estimee = ?, echauffement = ?,
        retour_au_calme = ?, partage = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
    ).run(data.nom, data.description, data.type, duree, data.echauffement, data.retour_au_calme, data.partage, id, req.user.id);
    saveItems(db, id, req.user.id, data.items);
    res.json({ session: sessionWithExercises(db, id, req.user.id) });
  } catch (e) {
    if (e instanceof ValidationError) return apiError(res, 400, e.message);
    throw e;
  }
});

router.post('/:id/duplicate', (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const src = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!src) return apiError(res, 404, 'Session introuvable');
  const info = db.prepare(
    `INSERT INTO sessions (user_id, nom, description, type, duree_estimee, echauffement, retour_au_calme, partage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.user.id, `${src.nom} (copie)`, src.description, src.type, src.duree_estimee, src.echauffement, src.retour_au_calme, src.partage);
  const newId = info.lastInsertRowid;
  db.prepare(
    `INSERT INTO session_exercises (session_id, exercise_id, ordre, nom_libre, series, repetitions, temps_travail, repos, charge, notes)
     SELECT ?, exercise_id, ordre, nom_libre, series, repetitions, temps_travail, repos, charge, notes
     FROM session_exercises WHERE session_id = ? ORDER BY ordre`
  ).run(newId, id);
  res.status(201).json({ session: sessionWithExercises(db, newId, req.user.id) });
});

router.put('/:id/reorder', (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  if (!db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(id, req.user.id)) {
    return apiError(res, 404, 'Session introuvable');
  }
  const order = Array.isArray(req.body?.order) ? req.body.order.map(Number) : [];
  if (order.length === 0) return apiError(res, 400, 'Ordre invalide');
  const rows = db.prepare('SELECT id FROM session_exercises WHERE session_id = ?').all(id).map((r) => r.id);
  const set = new Set(rows);
  if (order.length !== rows.length || !order.every((x) => set.has(x))) {
    return apiError(res, 400, 'Ordre invalide');
  }
  const tx = db.transaction(() => {
    const upd = db.prepare('UPDATE session_exercises SET ordre = ? WHERE id = ? AND session_id = ?');
    order.forEach((itemId, idx) => upd.run(idx, itemId, id));
  });
  tx();
  res.json({ session: sessionWithExercises(db, id, req.user.id) });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const info = getDb().prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, req.user.id);
  if (info.changes === 0) return apiError(res, 404, 'Session introuvable');
  res.json({ ok: true });
});

export default router;
