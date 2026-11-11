import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../docs/js/api.js');
const { get, post, put, importData, resetLocalData, exportData, ApiError } = api;
const { encodeShare, decodeShare } = await import('../docs/js/share.js');

before(() => {
  resetLocalData();
});

test('V2 static: partage par lien (base64url, unicode) aller-retour', () => {
  const payload = { v: 1, nom: 'Séance « Dos & mobilité » 🏋️', items: [{ nom: 'Rowing', series: 4 }] };
  const enc = encodeShare(payload);
  assert.match(enc, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeShare(enc), payload);
});

test('V2 static: import/export de données', async () => {
  await post('/api/exercises', { nom: 'Squat', categorie: 'renforcement', groupe_musculaire: 'quadriceps', favori: true });
  const s = await post('/api/sessions', { nom: 'Jambes', type: 'renforcement', items: [{ nom_libre: 'Squat', series: 4, repetitions: 10 }] });
  await post('/api/planned', { session_id: s.session.id, date: '2025-06-02', heure: '18:00', recurrence: 'weekly' });
  const exp = await exportData();

  resetLocalData();
  let r = await get('/api/exercises');
  assert.equal(r.exercises.length, 0);

  const res = importData(JSON.parse(JSON.stringify(exp)));
  assert.equal(res.ok, true);
  assert.equal(res.counts.exercises, 1);
  assert.equal(res.counts.sessions, 1);
  assert.equal(res.counts.planned, 1);

  r = await get('/api/exercises?q=squat');
  assert.equal(r.exercises.length, 1);
  assert.equal(r.exercises[0].favori, true);
  r = await get('/api/planned?from=2025-06-01&to=2025-06-30');
  assert.deepEqual(r.planned.map((p) => p.occurrenceDate), ['2025-06-02', '2025-06-09', '2025-06-16', '2025-06-23', '2025-06-30']);

  assert.throws(() => importData({ foo: 1 }), (e) => e instanceof ApiError && e.status === 400);
  assert.throws(() => importData(null), (e) => e.status === 400);
});

test('V2 static: rappel sur planification (création, édition, persistance)', async () => {
  resetLocalData();
  let r = await post('/api/planned', { titre_libre: 'Étirements', date: '2025-06-02', heure: '20:00', rappel: { actif: true, minutes: 30 } });
  assert.equal(r.planned.id > 0, true);
  assert.deepEqual(r.planned.rappel, { actif: true, minutes: 30 });

  const id = r.planned.id;
  r = await put(`/api/planned/${id}`, { rappel: { actif: true, minutes: 10 } });
  assert.deepEqual(r.planned.rappel, { actif: true, minutes: 10 });

  r = await get(`/api/planned/${id}`);
  assert.deepEqual(r.planned.rappel, { actif: true, minutes: 10 });

  r = await get('/api/planned?from=2025-06-01&to=2025-06-30');
  assert.deepEqual(r.planned[0].rappel, { actif: true, minutes: 10 });

  await assert.rejects(() => post('/api/planned', { titre_libre: 'X', date: '2025-06-02', rappel: { actif: true, minutes: 99999 } }), (e) => e.status === 400);
});

test('régression: les hrefs de navigation commencent par #/ (sinon retour au calendrier)', async () => {
  const fs = await import('node:fs');
  for (const p of ['docs/js/main.js', 'public/js/main.js']) {
    const src = fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
    const navBlock = src.match(/const NAV = \[([\s\S]*?)\];/)[1];
    const hrefs = [...navBlock.matchAll(/\['(#[^']*)'/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 5, `${p}: NAV trouvé`);
    for (const href of hrefs) assert.ok(href.startsWith('#/'), `${p}: href invalide ${href}`);
    assert.ok(src.includes('normalizeHash') || src.includes('startsWith(\'#/\')'), `${p}: normalisation du hash présente`);
  }
});

test('exemple: docs/exemple-exercices.json est importable (2 exercices de renforcement)', async () => {
  const fs = await import('node:fs');
  const json = JSON.parse(fs.readFileSync(new URL('../docs/exemple-exercices.json', import.meta.url), 'utf8'));
  resetLocalData();
  const res = importData(json);
  assert.equal(res.counts.exercises, 2);
  const list = await get('/api/exercises?categorie=renforcement');
  assert.equal(list.exercises.length, 2);
  const squat = list.exercises.find((e) => e.nom === 'Squat');
  assert.equal(squat.groupe_musculaire, 'quadriceps');
  assert.equal(squat.series_defaut, 4);
  assert.equal(squat.favori, true);
  assert.ok(Array.isArray(squat.tags) && squat.tags.includes('jambes'));
  const dc = list.exercises.find((e) => e.nom === 'Développé couché');
  assert.equal(dc.niveau, 'intermédiaire');
  assert.deepEqual(dc.equipement, ['barre', 'banc', 'haltères']);
  resetLocalData();
});

test('V2 static: import = fusion, les fiches existantes ne sont pas écrasées', async () => {
  const fs = await import('node:fs');
  resetLocalData();
  const a = await post('/api/exercises', { nom: 'Squat perso', categorie: 'renforcement', groupe_musculaire: 'quadriceps', favori: true, series_defaut: 5, repetitions_defaut: 5 });
  const s = await post('/api/sessions', { nom: 'Jambes perso', type: 'renforcement', items: [{ exercise_id: a.exercise.id, series: 3, repetitions: 8 }] });
  await post('/api/planned', { session_id: s.session.id, date: '2025-07-01', heure: '07:00', recurrence: 'none' });

  const ex = JSON.parse(fs.readFileSync(new URL('../docs/exemple-exercices.json', import.meta.url), 'utf8'));
  const res = importData(ex);
  assert.equal(res.added.exercises, 2);
  assert.equal(res.counts.exercises, 3);
  assert.equal(res.counts.sessions, 1);
  assert.equal(res.counts.planned, 1);

  let list = await get('/api/exercises');
  const perso = list.exercises.find((e) => e.nom === 'Squat perso');
  assert.ok(perso);
  assert.equal(perso.id, a.exercise.id);
  assert.equal(perso.favori, true);
  assert.equal(perso.series_defaut, 5);
  assert.ok(list.exercises.some((e) => e.nom === 'Squat'));
  assert.equal(new Set(list.exercises.map((e) => e.id)).size, 3);

  const trail = { exercises: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, nom: `Ex trail ${i + 1}`, categorie: 'renforcement', activite: 'trail', groupe_musculaire: 'quadriceps' })), sessions: [], planned: [] };
  const res2 = importData(trail);
  assert.equal(res2.added.exercises, 10);
  assert.equal(res2.counts.exercises, 13);
  list = await get('/api/exercises?activite=trail');
  assert.equal(list.exercises.length, 10);
  const perso2 = (await get('/api/exercises')).exercises.find((e) => e.nom === 'Squat perso');
  assert.equal(perso2.id, a.exercise.id);
  assert.equal(perso2.favori, true);

  importData(ex);
  list = await get('/api/exercises');
  assert.equal(list.exercises.length, 15);
  assert.equal(new Set(list.exercises.map((e) => e.id)).size, 15);
  const detail = await get(`/api/sessions/${s.session.id}`);
  assert.equal(detail.session.nom, 'Jambes perso');
  assert.equal(detail.session.items[0].exercise_id, a.exercise.id);
  resetLocalData();
});

test('V2 static: import fusionne sessions/planned avec re-liaison vers les nouveaux ids', async () => {
  resetLocalData();
  const a = await post('/api/exercises', { nom: 'Existant', categorie: 'renforcement' });
  const payload = {
    exercises: [{ id: 7, nom: 'Fente importée', categorie: 'renforcement', activite: 'trail', groupe_musculaire: 'quadriceps', equipement: ['poids du corps'], series_defaut: 3, repetitions_defaut: 10 }],
    sessions: [{ id: 4, nom: 'Séance importée', type: 'renforcement', items: [{ id: 9, exercise_id: 7, nom_libre: '', series: 3, repetitions: 10 }] }],
    planned: [{ id: 2, session_id: 4, titre_libre: '', date: '2025-08-05', heure: '06:30', recurrence: 'none', logs: [{ id: 3, session_exercise_id: 9, exercice: 'Fente importée', series_realisees: 3, repetitions_realisees: 10, sensation: 'correct' }] }],
  };
  const res = importData(payload);
  assert.deepEqual(res.added, { exercises: 1, sessions: 1, planned: 1 });
  const exs = (await get('/api/exercises')).exercises;
  assert.equal(exs.length, 2);
  const importe = exs.find((e) => e.nom === 'Fente importée');
  assert.ok(importe.id !== 7 && importe.id !== a.exercise.id);
  const sess = await get('/api/sessions');
  assert.equal(sess.sessions.length, 1);
  const detail = await get(`/api/sessions/${sess.sessions[0].id}`);
  assert.equal(detail.session.items[0].exercise_id, importe.id);
  assert.equal(detail.session.items[0].exercise_nom, 'Fente importée');
  const planned = (await get('/api/planned?from=2025-08-01&to=2025-08-31')).planned;
  assert.equal(planned.length, 1);
  assert.equal(planned[0].session_id, sess.sessions[0].id);
  assert.equal(planned[0].logs[0].session_exercise_id, detail.session.items[0].id);
  resetLocalData();
});
