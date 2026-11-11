import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../docs/js/api.js');
const { get, post, put, del, uploadMedia, exportData, resetLocalData, ApiError } = api;

before(() => {
  resetLocalData();
});

test('static: profil local', async () => {
  let r = await get('/api/auth/me');
  assert.equal(r.user.email, 'local');
  r = await put('/api/auth/me', { name: 'Zian', niveau: 'avancé', objectifs: ['performance'] });
  assert.equal(r.user.name, 'Zian');
  assert.equal(r.user.niveau, 'avancé');
  assert.deepEqual(r.user.objectifs, ['performance']);
});

test('static: exercices CRUD + recherche/filtres + duplication + favori', async () => {
  let r = await post('/api/exercises', {
    nom: 'Développé couché', categorie: 'renforcement', groupe_musculaire: 'pectoraux',
    niveau: 'intermédiaire', equipement: ['barre'], tags: ['push'], series_defaut: 4, repetitions_defaut: 10, favori: true,
  });
  const exId = r.exercise.id;
  await post('/api/exercises', { nom: 'Étirement ischios', categorie: 'mobilité', groupe_musculaire: 'chaîne postérieure', equipement: ['poids du corps'] });

  r = await get('/api/exercises');
  assert.equal(r.exercises.length, 2);
  r = await get('/api/exercises?q=étirement');
  assert.equal(r.exercises.length, 1);
  r = await get('/api/exercises?categorie=renforcement');
  assert.equal(r.exercises.length, 1);
  r = await get('/api/exercises?equipement=barre');
  assert.equal(r.exercises.length, 1);
  r = await get('/api/exercises?favori=1');
  assert.equal(r.exercises.length, 1);
  r = await get('/api/exercises/facets');
  assert.ok(r.groupes.includes('pectoraux'));
  assert.ok(r.equipements.includes('barre'));

  r = await put(`/api/exercises/${exId}`, { nom: 'Développé couché', categorie: 'renforcement', niveau: 'avancé', favori: false });
  assert.equal(r.exercise.niveau, 'avancé');
  r = await post(`/api/exercises/${exId}/duplicate`);
  assert.match(r.exercise.nom, /copie/);
  r = await post(`/api/exercises/${exId}/favori`, { favori: true });
  assert.equal(r.exercise.favori, true);
  r = await del(`/api/exercises/${exId}`);
  assert.equal(r.ok, true);
  r = await get('/api/exercises');
  assert.equal(r.exercises.length, 2);
});

test('static: sessions avec exercices ordonnés + réordonnancement + duplication', async () => {
  const e1 = (await post('/api/exercises', { nom: 'Squat', categorie: 'renforcement', groupe_musculaire: 'quadriceps' })).exercise;
  const e2 = (await post('/api/exercises', { nom: 'Pompe', categorie: 'renforcement', groupe_musculaire: 'pectoraux' })).exercise;
  let r = await post('/api/sessions', {
    nom: 'Full body', type: 'renforcement',
    items: [
      { exercise_id: e1.id, series: 4, repetitions: 10, repos: 90 },
      { exercise_id: e2.id, series: 3, repetitions: 12 },
      { nom_libre: 'Planche', series: 3, temps_travail: 30 },
    ],
  });
  const sId = r.session.id;
  assert.equal(r.session.items.length, 3);
  assert.equal(r.session.items[0].exercise_nom, 'Squat');
  assert.ok(r.session.duree_estimee > 0);

  const ids = r.session.items.map((i) => i.id);
  r = await put(`/api/sessions/${sId}/reorder`, { order: [ids[2], ids[0], ids[1]] });
  assert.equal(r.session.items[0].nom_libre, 'Planche');
  await assert.rejects(() => put(`/api/sessions/${sId}/reorder`, { order: [ids[0]] }), (e) => e.status === 400);

  r = await post(`/api/sessions/${sId}/duplicate`);
  assert.equal(r.session.items.length, 3);
  r = await get('/api/sessions?q=full');
  assert.equal(r.sessions.length, 2);
  r = await get(`/api/sessions/${sId}`);
  assert.equal(r.session.items.length, 3);
});

test('static: planification (hebdo, custom+fin, déplacement), logs, historique, stats', async () => {
  const e = (await post('/api/exercises', { nom: 'Rowing', categorie: 'renforcement', groupe_musculaire: 'dos' })).exercise;
  const s = (await post('/api/sessions', { nom: 'Dos', type: 'renforcement', items: [{ exercise_id: e.id, series: 4, repetitions: 12 }] })).session;
  const itemId = s.items[0].id;

  let r = await post('/api/planned', { session_id: s.id, date: '2025-06-02', heure: '07:30', recurrence: 'weekly' });
  const pId = r.planned.id;
  assert.equal(r.planned.couleur, '#e05252');
  assert.equal(r.planned.session_nom, 'Dos');

  r = await get('/api/planned?from=2025-06-01&to=2025-06-30');
  assert.deepEqual(r.planned.filter((p) => p.id === pId).map((p) => p.occurrenceDate),
    ['2025-06-02', '2025-06-09', '2025-06-16', '2025-06-23', '2025-06-30']);

  r = await post('/api/planned', { titre_libre: 'Mobility', date: '2025-06-02', recurrence: 'custom', jours: [1, 4], fin_recurrence: '2025-06-10' });
  const cId = r.planned.id;
  r = await get('/api/planned?from=2025-06-01&to=2025-06-30');
  assert.deepEqual(r.planned.filter((p) => p.id === cId).map((p) => p.occurrenceDate), ['2025-06-02', '2025-06-05', '2025-06-09']);

  await assert.rejects(() => post('/api/planned', { titre_libre: 'X', date: '2025-06-02', recurrence: 'custom', jours: [] }), (e) => e.status === 400);

  r = await put(`/api/planned/${pId}`, { date: '2025-06-04' });
  assert.equal(r.planned.date, '2025-06-04');
  r = await get(`/api/planned/${pId}`);
  assert.equal(r.planned.occurrenceDate, '2025-06-04');

  r = await post(`/api/planned/${pId}/logs`, {
    logs: [{ session_exercise_id: itemId, exercice: 'Rowing', series_realisees: 4, repetitions_realisees: 12, charge_utilisee: '20 kg', sensation: 'correct' }],
    notes: 'Bonne séance',
  });
  assert.equal(r.planned.effectuee, true);
  assert.equal(r.planned.logs.length, 1);

  r = await get('/api/history?from=2025-06-01&to=2025-06-30');
  assert.equal(r.history.length, 1);
  assert.equal(r.history[0].titre, 'Dos');
  r = await get('/api/history?groupe=pectoraux');
  assert.equal(r.history.length, 0);
  r = await get('/api/history?groupe=dos');
  assert.equal(r.history.length, 1);

  r = await get('/api/stats?from=2025-06-01&to=2025-06-30');
  assert.equal(r.stats.totalSeances, 1);
  assert.equal(r.stats.volumeTotal, 4 * 12 * 20);
  assert.equal(r.stats.volumeParSemaine.length, 1);
  assert.deepEqual(r.stats.volumeParGroupe, [{ groupe: 'dos', volume: 960 }]);
  assert.equal(r.stats.progressionParExercice[0].points[0].chargeMax, 20);
  assert.ok(r.stats.streakSemaines >= 1);

  r = await del(`/api/planned/${cId}`);
  assert.equal(r.ok, true);
});

test('static: médias locaux (upload idb, rejet extension, export)', async () => {
  const png = new File([Buffer.from('89504e47', 'hex')], 'img.png', { type: 'image/png' });
  const up = await uploadMedia(png);
  assert.match(up.url, /^idb:\/\/[a-f0-9]{32}\.png$/);
  const key = up.url.replace(/^idb:\/\//, '').replace(/\.png$/, '');

  await assert.rejects(() => uploadMedia(new File([Buffer.from('MZ')], 'x.exe', { type: 'application/octet-stream' })), (e) => e.status === 400);

  const ex = (await post('/api/exercises', { nom: 'Avec média', categorie: 'mobilité', media_url: up.url })).exercise;
  const exp = await exportData();
  assert.ok(exp.exercises.some((e) => e.id === ex.id && e.media_url === up.url));

  const r = await del(`/api/media/${key}`);
  assert.equal(r.ok, true);
});

test('static: reset des données locales', async () => {
  await del('/api/auth/me');
  const r = await get('/api/exercises');
  assert.equal(r.exercises.length, 0);
  const me = await get('/api/auth/me');
  assert.equal(me.user.name, '');
});
