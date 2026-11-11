import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrs-v15-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');

const { createApp } = await import('../server/app.js');

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  async function req(method, url, body, rawHeaders) {
    const headers = rawHeaders || { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    const res = await fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers, raw: text };
  }
  return {
    req,
    get: (url) => req('GET', url),
    post: (url, body) => req('POST', url, body),
    put: (url, body) => req('PUT', url, body),
    delete: (url) => req('DELETE', url),
    upload: (url, buffer, contentType, filename) => req('POST', `${url}?filename=${encodeURIComponent(filename)}`, buffer, { 'content-type': contentType }),
  };
}

async function registerUser(email) {
  const c = client();
  const r = await c.post('/api/auth/register', { email, password: 'motdepasse123' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return c;
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

test('V1.5 récurrence custom (jours personnalisés) + fin de récurrence', async () => {
  const alice = await registerUser('rec-custom@test.fr');

  let r = await alice.post('/api/planned', { titre_libre: 'Étirements', date: '2025-06-02', recurrence: 'custom', jours: [1, 4] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.planned.id;
  assert.deepEqual(r.data.planned.jours, [1, 4]);

  r = await alice.get('/api/planned?from=2025-06-01&to=2025-06-30');
  const occ = r.data.planned.filter((p) => p.id === id).map((p) => p.occurrenceDate);
  assert.deepEqual(occ, ['2025-06-02', '2025-06-05', '2025-06-09', '2025-06-12', '2025-06-16', '2025-06-19', '2025-06-23', '2025-06-26', '2025-06-30']);

  r = await alice.put(`/api/planned/${id}`, { fin_recurrence: '2025-06-10' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await alice.get('/api/planned?from=2025-06-01&to=2025-06-30');
  const occFin = r.data.planned.filter((p) => p.id === id).map((p) => p.occurrenceDate);
  assert.deepEqual(occFin, ['2025-06-02', '2025-06-05', '2025-06-09']);

  r = await alice.post('/api/planned', { titre_libre: 'Bad', date: '2025-06-02', recurrence: 'custom', jours: [] });
  assert.equal(r.status, 400);

  r = await alice.post('/api/planned', { titre_libre: 'Bad2', date: '2025-06-02', recurrence: 'custom', jours: [9] });
  assert.equal(r.status, 400);

  r = await alice.put(`/api/planned/${id}`, { fin_recurrence: '2025-01-01' });
  assert.equal(r.status, 400);

  r = await alice.post('/api/planned', { titre_libre: 'Quotidien', date: '2025-06-02', recurrence: 'daily', fin_recurrence: '2025-06-05' });
  assert.equal(r.status, 201);
  const dailyId = r.data.planned.id;
  r = await alice.get('/api/planned?from=2025-06-01&to=2025-06-30');
  const occDaily = r.data.planned.filter((p) => p.id === dailyId).map((p) => p.occurrenceDate);
  assert.deepEqual(occDaily, ['2025-06-02', '2025-06-03', '2025-06-04', '2025-06-05']);
});

test('V1.5 GET /api/planned/:id + isolement', async () => {
  const alice = await registerUser('planned-id-a@test.fr');
  const bob = await registerUser('planned-id-b@test.fr');
  const created = await alice.post('/api/planned', { titre_libre: 'Solo', date: '2025-07-01', heure: '08:00' });
  const id = created.data.planned.id;

  let r = await alice.get(`/api/planned/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.planned.id, id);
  assert.equal(r.data.planned.occurrenceDate, '2025-07-01');

  r = await bob.get(`/api/planned/${id}`);
  assert.equal(r.status, 404);

  const anon = client();
  r = await anon.get(`/api/planned/${id}`);
  assert.equal(r.status, 401);
});

test('V1.5 médias: upload, service privé, ACL, liaison exercice, suppression', async () => {
  const alice = await registerUser('media-a@test.fr');
  const bob = await registerUser('media-b@test.fr');

  let r = await alice.upload('/api/media/upload', PNG_1PX, 'image/png', 'capture.png');
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const { url, key } = r.data;
  assert.match(url, new RegExp(`^/api/media/${key}$`));

  r = await alice.get(url);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /image\/png/);

  r = await bob.get(url);
  assert.equal(r.status, 404);

  const anon = client();
  r = await anon.get(url);
  assert.equal(r.status, 401);

  r = await alice.upload('/api/media/upload', Buffer.from('MZ'), 'application/octet-stream', 'virus.exe');
  assert.equal(r.status, 415);

  r = await alice.upload('/api/media/upload', Buffer.from('MZ'), 'image/png', 'faux.exe');
  assert.equal(r.status, 400);

  const ex = await alice.post('/api/exercises', { nom: 'Squat', categorie: 'renforcement', groupe_musculaire: 'quadriceps' });
  const exId = ex.data.exercise.id;
  r = await alice.put(`/api/exercises/${exId}`, { nom: 'Squat', categorie: 'renforcement', groupe_musculaire: 'quadriceps', media_url: url });
  assert.equal(r.status, 200);
  assert.equal(r.data.exercise.media_url, url);

  r = await alice.delete(`/api/exercises/${exId}`);
  assert.equal(r.status, 200);
  r = await alice.get(url);
  assert.equal(r.status, 404);

  const up2 = await alice.upload('/api/media/upload', PNG_1PX, 'image/png', 'autre.png');
  r = await alice.delete(`/api/media/${up2.data.key}`);
  assert.equal(r.status, 200);
  r = await alice.get(up2.data.url);
  assert.equal(r.status, 404);
  r = await bob.delete(`/api/media/${up2.data.key}`);
  assert.equal(r.status, 404);
});

test('V1.5 stats avancées: volume/semaine, par groupe, progression, streak, par mois', async () => {
  const alice = await registerUser('stats-v15@test.fr');
  const ex = (await alice.post('/api/exercises', {
    nom: 'Développé militaire', categorie: 'renforcement', groupe_musculaire: 'épaules', equipement: ['haltères'],
  })).data.exercise;
  const sess = (await alice.post('/api/sessions', {
    nom: 'Épaules', type: 'renforcement',
    items: [{ exercise_id: ex.id, series: 4, repetitions: 10 }],
  })).data.session;
  const itemId = sess.items[0].id;

  const p1 = (await alice.post('/api/planned', { session_id: sess.id, date: '2025-06-02', recurrence: 'none' })).data.planned;
  const p2 = (await alice.post('/api/planned', { session_id: sess.id, date: '2025-06-09', recurrence: 'none' })).data.planned;

  await alice.post(`/api/planned/${p1.id}/logs`, {
    logs: [{ session_exercise_id: itemId, exercice: 'Développé militaire', series_realisees: 4, repetitions_realisees: 10, charge_utilisee: '20 kg', sensation: 'correct' }],
  });
  await alice.post(`/api/planned/${p2.id}/logs`, {
    logs: [{ session_exercise_id: itemId, exercice: 'Développé militaire', series_realisees: 4, repetitions_realisees: 10, charge_utilisee: '22 kg', sensation: 'facile' }],
  });

  const r = await alice.get('/api/stats?from=2025-06-01&to=2025-06-30');
  assert.equal(r.status, 200);
  const s = r.data.stats;
  assert.equal(s.totalSeances, 2);
  assert.equal(s.volumeTotal, 4 * 10 * 20 + 4 * 10 * 22);
  assert.ok(Array.isArray(s.parMois) && s.parMois.length === 1 && s.parMois[0].mois === '2025-06');
  assert.equal(s.volumeParSemaine.length, 2);
  assert.equal(s.volumeParSemaine[0].volume, 800);
  assert.equal(s.volumeParSemaine[1].volume, 880);
  assert.deepEqual(s.volumeParGroupe, [{ groupe: 'épaules', volume: 1680 }]);
  assert.equal(s.progressionParExercice.length, 1);
  assert.equal(s.progressionParExercice[0].exercice, 'Développé militaire');
  assert.deepEqual(s.progressionParExercice[0].points.map((p) => p.chargeMax), [20, 22]);
  assert.ok(s.streakSemaines >= 2, `streak attendu >= 2, reçu ${s.streakSemaines}`);
});
