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
