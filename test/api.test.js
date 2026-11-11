import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrs-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

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
  return {
    async req(method, url, body) {
      const headers = { 'content-type': 'application/json' };
      if (cookie) headers.cookie = cookie;
      const res = await fetch(base + url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      let data = null;
      const text = await res.text();
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
      return { status: res.status, data };
    },
    get: (url) => client_req('GET', url),
    post: (url, body) => client_req('POST', url, body),
    put: (url, body) => client_req('PUT', url, body),
    del: (url) => client_req('DELETE', url),
    delete: (url) => client_req('DELETE', url),
  };
  async function client_req(method, url, body) {
    const headers = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    const res = await fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    return { status: res.status, data };
  }
}

async function registerUser(email, password = 'motdepasse123') {
  const c = client();
  const r = await c.post('/api/auth/register', { email, password, name: email.split('@')[0], niveau: 'débutant', objectifs: ['mobilité'] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return c;
}

test('auth: register, me, login, logout, mauvais mot de passe', async () => {
  const c = client();
  let r = await c.post('/api/auth/register', { email: 'alice@test.fr', password: 'motdepasse123', name: 'Alice' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, 'alice@test.fr');

  r = await c.post('/api/auth/register', { email: 'alice@test.fr', password: 'motdepasse123' });
  assert.equal(r.status, 409);

  r = await c.post('/api/auth/register', { email: 'bad', password: 'motdepasse123' });
  assert.equal(r.status, 400);

  r = await c.post('/api/auth/register', { email: 'short@test.fr', password: 'court' });
  assert.equal(r.status, 400);

  r = await c.get('/api/auth/me');
  assert.equal(r.status, 200);
  assert.equal(r.data.user.name, 'Alice');

  await c.post('/api/auth/logout');
  r = await c.get('/api/auth/me');
  assert.equal(r.status, 401);

  r = await c.post('/api/auth/login', { email: 'alice@test.fr', password: 'mauvais-mot-de-passe' });
  assert.equal(r.status, 401);

  r = await c.post('/api/auth/login', { email: 'alice@test.fr', password: 'motdepasse123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, 'alice@test.fr');
});

test('auth: routes protégées renvoient 401 sans session', async () => {
  const c = client();
  for (const url of ['/api/exercises', '/api/sessions', '/api/planned?from=2025-01-01&to=2025-01-31', '/api/history', '/api/stats']) {
    const r = await c.get(url);
    assert.equal(r.status, 401, url);
  }
});

test('exercices: CRUD, recherche, filtres, duplication, favori, isolation utilisateur', async () => {
  const alice = await registerUser('exo-alice@test.fr');
  const bob = await registerUser('exo-bob@test.fr');

  let r = await alice.post('/api/exercises', {
    nom: 'Développé couché', categorie: 'renforcement', groupe_musculaire: 'pectoraux',
    niveau: 'intermédiaire', equipement: ['barre', 'haltères'], description: 'Allongé, pousser la barre',
    series_defaut: 4, repetitions_defaut: 10, repos_defaut: 90, charge_conseille: '20 kg',
    tags: ['push', 'haut du corps'], favori: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const exId = r.data.exercise.id;
  assert.deepEqual(r.data.exercise.equipement, ['barre', 'haltères']);
  assert.equal(r.data.exercise.favori, true);

  r = await alice.post('/api/exercises', {
    nom: 'Étirement des ischio-jambiers', categorie: 'mobilité', groupe_musculaire: 'chaîne postérieure',
    niveau: 'débutant', equipement: ['poids du corps'], tags: ['étirement'],
  });
  assert.equal(r.status, 201);

  r = await alice.get('/api/exercises');
  assert.equal(r.data.exercises.length, 2);

  r = await alice.get('/api/exercises?q=étirement');
  assert.equal(r.data.exercises.length, 1);
  assert.equal(r.data.exercises[0].nom, 'Étirement des ischio-jambiers');

  r = await alice.get('/api/exercises?categorie=renforcement');
  assert.equal(r.data.exercises.length, 1);

  r = await alice.get('/api/exercises?equipement=barre');
  assert.equal(r.data.exercises.length, 1);

  r = await alice.get('/api/exercises?favori=1');
  assert.equal(r.data.exercises.length, 1);
  assert.equal(r.data.exercises[0].favori, true);

  r = await alice.get('/api/exercises?niveau=avancé');
  assert.equal(r.data.exercises.length, 0);

  r = await alice.put(`/api/exercises/${exId}`, {
    nom: 'Développé couché', categorie: 'renforcement', groupe_musculaire: 'pectoraux',
    niveau: 'avancé', equipement: ['barre'], series_defaut: 5, repetitions_defaut: 5, repos_defaut: 120,
    tags: ['push'], favori: false,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.exercise.niveau, 'avancé');
  assert.equal(r.data.exercise.favori, false);

  r = await alice.post(`/api/exercises/${exId}/duplicate`);
  assert.equal(r.status, 201);
  assert.match(r.data.exercise.nom, /copie/);

  r = await alice.post(`/api/exercises/${exId}/favori`, { favori: true });
  assert.equal(r.data.exercise.favori, true);

  r = await bob.get('/api/exercises');
  assert.equal(r.data.exercises.length, 0);
  r = await bob.get(`/api/exercises/${exId}`);
  assert.equal(r.status, 404);
  r = await bob.delete(`/api/exercises/${exId}`);
  assert.equal(r.status, 404);

  r = await alice.delete(`/api/exercises/${exId}`);
  assert.equal(r.status, 200);
  r = await alice.get('/api/exercises?q=développé');
  assert.equal(r.data.exercises.length, 1);
});

test('sessions: création avec exercices ordonnés, réordonnancement, duplication, isolement', async () => {
  const alice = await registerUser('sess-alice@test.fr');
  const bob = await registerUser('sess-bob@test.fr');

  const e1 = (await alice.post('/api/exercises', { nom: 'Squat', categorie: 'renforcement', groupe_musculaire: 'quadriceps', equipement: ['poids du corps'], series_defaut: 3, repetitions_defaut: 12, repos_defaut: 60 })).data.exercise;
  const e2 = (await alice.post('/api/exercises', { nom: 'Pompe', categorie: 'renforcement', groupe_musculaire: 'pectoraux', equipement: ['poids du corps'], series_defaut: 3, repetitions_defaut: 10, repos_defaut: 60 })).data.exercise;

  let r = await alice.post('/api/sessions', {
    nom: 'Full body débutant', description: 'Séance complète', type: 'renforcement',
    echauffement: '5 min de corde à sauter', retour_au_calme: 'Étirements',
    items: [
      { exercise_id: e1.id, series: 4, repetitions: 10, repos: 90, charge: '0' },
      { exercise_id: e2.id, series: 3, repetitions: 12, repos: 60 },
      { nom_libre: 'Planche', series: 3, temps_travail: 30, repos: 30 },
    ],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const sId = r.data.session.id;
  assert.equal(r.data.session.items.length, 3);
  assert.ok(r.data.session.duree_estimee > 0);
  assert.equal(r.data.session.items[0].exercise_nom, 'Squat');

  const itemIds = r.data.session.items.map((i) => i.id);
  r = await alice.put(`/api/sessions/${sId}/reorder`, { order: [itemIds[2], itemIds[0], itemIds[1]] });
  assert.equal(r.status, 200);
  assert.equal(r.data.session.items[0].nom_libre, 'Planche');

  r = await alice.put(`/api/sessions/${sId}/reorder`, { order: [itemIds[0]] });
  assert.equal(r.status, 400);

  r = await alice.post(`/api/sessions/${sId}/duplicate`);
  assert.equal(r.status, 201);
  assert.equal(r.data.session.items.length, 3);

  r = await bob.get(`/api/sessions/${sId}`);
  assert.equal(r.status, 404);

  r = await alice.put(`/api/sessions/${sId}`, { nom: 'Full body A', type: 'mixte', items: [{ exercise_id: e1.id, series: 3, repetitions: 8 }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.session.nom, 'Full body A');
  assert.equal(r.data.session.items.length, 1);

  r = await alice.delete(`/api/sessions/${sId}`);
  assert.equal(r.status, 200);
});

test('planification: créer, récurrence hebdomadaire, déplacer, effectuer + logs, historique, stats', async () => {
  const alice = await registerUser('plan-alice@test.fr');

  const ex = (await alice.post('/api/exercises', { nom: 'Rowing', categorie: 'renforcement', groupe_musculaire: 'dos', equipement: ['élastique'], series_defaut: 3, repetitions_defaut: 15, charge_conseille: '10 kg' })).data.exercise;
  const sess = (await alice.post('/api/sessions', {
    nom: 'Dos + mobilité', type: 'mixte',
    items: [{ exercise_id: ex.id, series: 4, repetitions: 12, charge: '12 kg' }],
  })).data.session;

  let r = await alice.post('/api/planned', { session_id: sess.id, date: '2025-06-02', heure: '07:30', recurrence: 'weekly' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const pId = r.data.planned.id;
  assert.equal(r.data.planned.couleur, '#3b6fd4');

  r = await alice.post('/api/planned', { titre_libre: 'Séance libre', date: '2025-06-03', recurrence: 'none' });
  assert.equal(r.status, 201);
  const freeId = r.data.planned.id;
  assert.equal(r.data.planned.couleur, '#8a8f98');

  r = await alice.post('/api/planned', { session_id: 99999, date: '2025-06-03' });
  assert.equal(r.status, 400);

  r = await alice.post('/api/planned', { date: '2025-06-03' });
  assert.equal(r.status, 400);

  r = await alice.post('/api/planned', { titre_libre: 'Bad date', date: '2025-13-40' });
  assert.equal(r.status, 400);

  r = await alice.get('/api/planned?from=2025-06-01&to=2025-06-30');
  assert.equal(r.status, 200);
  const mondays = r.data.planned.filter((p) => p.id === pId).map((p) => p.occurrenceDate);
  assert.deepEqual(mondays, ['2025-06-02', '2025-06-09', '2025-06-16', '2025-06-23', '2025-06-30']);

  r = await alice.put(`/api/planned/${pId}`, { date: '2025-06-04' });
  assert.equal(r.status, 200);
  assert.equal(r.data.planned.date, '2025-06-04');
  r = await alice.get('/api/planned?from=2025-06-01&to=2025-06-30');
  const wednesdays = r.data.planned.filter((p) => p.id === pId).map((p) => p.occurrenceDate);
  assert.deepEqual(wednesdays, ['2025-06-04', '2025-06-11', '2025-06-18', '2025-06-25']);

  const itemId = (await alice.get(`/api/sessions/${sess.id}`)).data.session.items[0].id;
  r = await alice.post(`/api/planned/${pId}/logs`, {
    logs: [
      { session_exercise_id: itemId, exercice: 'Rowing', series_realisees: 4, repetitions_realisees: 12, charge_utilisee: '12 kg', sensation: 'correct', commentaire: 'Bonne séance' },
    ],
    notes: 'RAS',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.planned.effectuee, true);
  assert.equal(r.data.planned.logs.length, 1);

  r = await alice.get('/api/history?from=2025-06-01&to=2025-06-30');
  assert.equal(r.status, 200);
  assert.equal(r.data.history.length, 1);
  assert.equal(r.data.history[0].titre, 'Dos + mobilité');
  assert.equal(r.data.history[0].logs[0].charge_utilisee, '12 kg');

  r = await alice.get('/api/history?from=2025-06-01&to=2025-06-30&type=mobilité');
  assert.equal(r.data.history.length, 0);
  r = await alice.get('/api/history?from=2025-06-01&to=2025-06-30&groupe=dos');
  assert.equal(r.data.history.length, 1);
  r = await alice.get('/api/history?from=2025-06-01&to=2025-06-30&groupe=pectoraux');
  assert.equal(r.data.history.length, 0);

  r = await alice.get('/api/stats?from=2025-06-01&to=2025-06-30');
  assert.equal(r.status, 200);
  assert.equal(r.data.stats.totalSeances, 1);
  assert.equal(r.data.stats.volumeTotal, 4 * 12 * 12);
  assert.equal(r.data.stats.repetitionsTotales, 48);
  const mixte = r.data.stats.repartition.find((x) => x.type === 'mixte');
  assert.equal(mixte.n, 1);

  r = await alice.put(`/api/planned/${freeId}`, { effectuee: true });
  assert.equal(r.data.planned.effectuee, true);

  r = await alice.delete(`/api/planned/${freeId}`);
  assert.equal(r.status, 200);
  r = await alice.get('/api/planned?from=2025-06-01&to=2025-06-30');
  assert.ok(!r.data.planned.some((p) => p.id === freeId && p.occurrenceDate === '2025-06-03'));
});

test('profil: mise à jour, export RGPD, suppression de compte', async () => {
  const alice = await registerUser('rgpd-alice@test.fr');
  await alice.post('/api/exercises', { nom: 'Fente', categorie: 'renforcement', groupe_musculaire: 'quadriceps' });

  let r = await alice.put('/api/auth/me', { name: 'Alice R', niveau: 'avancé', objectifs: ['prise de masse', 'performance'] });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.niveau, 'avancé');
  assert.deepEqual(r.data.user.objectifs, ['prise de masse', 'performance']);

  r = await alice.get('/api/auth/me/export');
  assert.equal(r.status, 200);
  assert.equal(r.data.exercises.length, 1);
  assert.equal(r.data.user.email, 'rgpd-alice@test.fr');

  r = await alice.delete('/api/auth/me');
  assert.equal(r.status, 200);
  r = await alice.get('/api/auth/me');
  assert.equal(r.status, 401);

  r = await alice.post('/api/auth/login', { email: 'rgpd-alice@test.fr', password: 'motdepasse123' });
  assert.equal(r.status, 401);
});

test('sécurité: mutation cross-origin refusée', async () => {
  const c = await registerUser('csrf-alice@test.fr');
  const res = await fetch(`${base}/api/exercises`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: (await c.get('/api/auth/me'), ''), origin: 'https://evil.example.com' },
    body: JSON.stringify({ nom: 'X' }),
  });
  assert.equal(res.status, 403);
});
