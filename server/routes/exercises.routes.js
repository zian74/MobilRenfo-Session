import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth, str, intOrNull, oneOf, strArray, ValidationError, apiError } from '../auth.js';
import { mediaKeyFromUrl, deleteMediaByKey } from '../media.js';

const router = Router();
router.use(requireAuth);

const CATEGORIES = ['renforcement', 'mobilité'];
const NIVEAUX = ['débutant', 'intermédiaire', 'avancé'];

function parseExercise(row) {
  return {
    ...row,
    equipement: JSON.parse(row.equipement || '[]'),
    tags: JSON.parse(row.tags || '[]'),
    favori: !!row.favori,
  };
}

function readExerciseBody(body) {
  return {
    nom: str(body?.nom, { max: 120, required: true }),
    categorie: oneOf(str(body?.categorie, { max: 30 }), CATEGORIES, 'renforcement'),
    groupe_musculaire: str(body?.groupe_musculaire, { max: 80 }),
    niveau: oneOf(str(body?.niveau, { max: 30 }), NIVEAUX, 'débutant'),
    equipement: strArray(body?.equipement, { maxItems: 20, maxLen: 40 }),
    description: str(body?.description, { max: 4000 }),
    media_url: str(body?.media_url, { max: 500 }),
    series_defaut: intOrNull(body?.series_defaut, { min: 0, max: 1000 }),
    repetitions_defaut: intOrNull(body?.repetitions_defaut, { min: 0, max: 10000 }),
    temps_travail_defaut: intOrNull(body?.temps_travail_defaut, { min: 0, max: 36000 }),
    repos_defaut: intOrNull(body?.repos_defaut, { min: 0, max: 36000 }),
    delai_debut_defaut: intOrNull(body?.delai_debut_defaut, { min: 0, max: 3600 }),
    charge_conseille: str(body?.charge_conseille, { max: 60 }),
    tags: strArray(body?.tags, { maxItems: 20, maxLen: 40 }),
    favori: body?.favori ? 1 : 0,
  };
}

function ownExercise(req, res, id) {
  const row = getDb().prepare('SELECT * FROM exercises WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!row) {
    apiError(res, 404, 'Exercice introuvable');
    return null;
  }
  return row;
}

router.get('/', (req, res) => {
  const db = getDb();
  const q = str(req.query.q, { max: 100 });
  const params = [req.user.id];
  const where = ['user_id = ?'];
  if (q) {
    where.push("(nom LIKE ? OR description LIKE ? OR groupe_musculaire LIKE ? OR tags LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (req.query.categorie && CATEGORIES.includes(req.query.categorie)) {
    where.push('categorie = ?');
    params.push(req.query.categorie);
  }
  if (req.query.niveau && NIVEAUX.includes(req.query.niveau)) {
    where.push('niveau = ?');
    params.push(req.query.niveau);
  }
  if (req.query.groupe) {
    where.push('groupe_musculaire = ?');
    params.push(str(req.query.groupe, { max: 80 }));
  }
  if (req.query.equipement) {
    where.push('EXISTS (SELECT 1 FROM json_each(exercises.equipement) je WHERE je.value = ?)');
    params.push(str(req.query.equipement, { max: 40 }));
  }
  if (req.query.favori === '1') where.push('favori = 1');

  const sorts = {
    nom: 'nom COLLATE NOCASE ASC',
    recent: 'updated_at DESC',
    ancien: 'created_at ASC',
    favori: 'favori DESC, nom COLLATE NOCASE ASC',
  };
  const sort = sorts[req.query.sort] || sorts.recent;

  const rows = db
    .prepare(`SELECT * FROM exercises WHERE ${where.join(' AND ')} ORDER BY ${sort}, id DESC`)
    .all(...params);
  res.json({ exercises: rows.map(parseExercise) });
});

router.get('/facets', (req, res) => {
  const db = getDb();
  const groupes = db
    .prepare('SELECT DISTINCT groupe_musculaire FROM exercises WHERE user_id = ? AND groupe_musculaire != "" ORDER BY groupe_musculaire COLLATE NOCASE')
    .all(req.user.id).map((r) => r.groupe_musculaire);
  const equipements = db
    .prepare("SELECT DISTINCT je.value FROM exercises, json_each(exercises.equipement) je WHERE user_id = ? ORDER BY je.value COLLATE NOCASE")
    .all(req.user.id).map((r) => r.value);
  res.json({ groupes, equipements });
});

router.get('/:id', (req, res) => {
  const row = ownExercise(req, res, Number(req.params.id));
  if (!row) return;
  res.json({ exercise: parseExercise(row) });
});

router.post('/', (req, res) => {
  try {
    const data = readExerciseBody(req.body);
    const db = getDb();
    const info = db.prepare(
      `INSERT INTO exercises (user_id, nom, categorie, groupe_musculaire, niveau, equipement, description, media_url,
        series_defaut, repetitions_defaut, temps_travail_defaut, repos_defaut, delai_debut_defaut, charge_conseille, tags, favori)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.user.id, data.nom, data.categorie, data.groupe_musculaire, data.niveau,
      JSON.stringify(data.equipement), data.description, data.media_url,
      data.series_defaut, data.repetitions_defaut, data.temps_travail_defaut, data.repos_defaut, data.delai_debut_defaut,
      data.charge_conseille, JSON.stringify(data.tags), data.favori
    );
    const row = db.prepare('SELECT * FROM exercises WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ exercise: parseExercise(row) });
  } catch (e) {
    if (e instanceof ValidationError) return apiError(res, 400, e.message);
    throw e;
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!ownExercise(req, res, id)) return;
    const data = readExerciseBody(req.body);
    getDb().prepare(
      `UPDATE exercises SET nom = ?, categorie = ?, groupe_musculaire = ?, niveau = ?, equipement = ?, description = ?,
        media_url = ?, series_defaut = ?, repetitions_defaut = ?, temps_travail_defaut = ?, repos_defaut = ?,
        delai_debut_defaut = ?, charge_conseille = ?, tags = ?, favori = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
    ).run(
      data.nom, data.categorie, data.groupe_musculaire, data.niveau,
      JSON.stringify(data.equipement), data.description, data.media_url,
      data.series_defaut, data.repetitions_defaut, data.temps_travail_defaut, data.repos_defaut, data.delai_debut_defaut,
      data.charge_conseille, JSON.stringify(data.tags), data.favori, id, req.user.id
    );
    const row = getDb().prepare('SELECT * FROM exercises WHERE id = ?').get(id);
    res.json({ exercise: parseExercise(row) });
  } catch (e) {
    if (e instanceof ValidationError) return apiError(res, 400, e.message);
    throw e;
  }
});

router.post('/:id/duplicate', (req, res) => {
  const id = Number(req.params.id);
  const row = ownExercise(req, res, id);
  if (!row) return;
  const db = getDb();
  const info = db.prepare(
    `INSERT INTO exercises (user_id, nom, categorie, groupe_musculaire, niveau, equipement, description, media_url,
      series_defaut, repetitions_defaut, temps_travail_defaut, repos_defaut, delai_debut_defaut, charge_conseille, tags, favori)
     SELECT user_id, nom || ' (copie)', categorie, groupe_musculaire, niveau, equipement, description, media_url,
      series_defaut, repetitions_defaut, temps_travail_defaut, repos_defaut, delai_debut_defaut, charge_conseille, tags, 0
     FROM exercises WHERE id = ? AND user_id = ?`
  ).run(id, req.user.id);
  const copy = db.prepare('SELECT * FROM exercises WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ exercise: parseExercise(copy) });
});

router.post('/:id/favori', (req, res) => {
  const id = Number(req.params.id);
  if (!ownExercise(req, res, id)) return;
  const fav = req.body?.favori ? 1 : 0;
  getDb().prepare('UPDATE exercises SET favori = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?').run(fav, id, req.user.id);
  const row = getDb().prepare('SELECT * FROM exercises WHERE id = ?').get(id);
  res.json({ exercise: parseExercise(row) });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = ownExercise(req, res, id);
  if (!row) return;
  const key = mediaKeyFromUrl(row.media_url);
  getDb().prepare('DELETE FROM exercises WHERE id = ? AND user_id = ?').run(id, req.user.id);
  if (key) deleteMediaByKey(key, req.user.id);
  res.json({ ok: true });
});

export default router;
