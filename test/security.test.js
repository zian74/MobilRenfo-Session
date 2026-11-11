import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrs-sec-'));
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
    return { status: res.status, data, headers: res.headers };
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

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

test('sécurité: en-têtes HTTP présents, HSTS absent en clair', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy') || '';
  assert.ok(csp.includes("default-src 'self'"), csp);
  assert.ok(csp.includes("script-src 'self'"), csp);
  assert.ok(csp.includes("frame-ancestors 'none'"), csp);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.ok(res.headers.get('permissions-policy')?.includes('geolocation=()'));
  assert.equal(res.headers.get('strict-transport-security'), null);
});

test('sécurité: rate limit upload (20/h) → 429 avec Retry-After', async () => {
  const c = client();
  const r = await c.post('/api/auth/register', { email: 'rl-upload@test.fr', password: 'motdepasse123' });
  assert.equal(r.status, 201);
  let last;
  for (let i = 0; i < 21; i++) {
    last = await c.upload('/api/media/upload', PNG_1PX, 'image/png', `f${i}.png`);
  }
  assert.equal(last.status, 429, JSON.stringify(last.data));
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  assert.match(last.data.error, /upload/i);
});

test('sécurité: révocation globale des sessions (logout-all)', async () => {
  const email = 'logout-all@test.fr';
  const a = client();
  await a.post('/api/auth/register', { email, password: 'motdepasse123' });
  const b = client();
  let r = await b.post('/api/auth/login', { email, password: 'motdepasse123' });
  assert.equal(r.status, 200);
  r = await b.get('/api/auth/me');
  assert.equal(r.status, 200);

  r = await a.delete('/api/auth/sessions');
  assert.equal(r.status, 200);

  r = await b.get('/api/auth/me');
  assert.equal(r.status, 401);
  r = await a.get('/api/auth/me');
  assert.equal(r.status, 401);

  r = await b.post('/api/auth/login', { email, password: 'motdepasse123' });
  assert.equal(r.status, 200);
  r = await b.get('/api/auth/me');
  assert.equal(r.status, 200);
});

test('sécurité: rate limit login (10/15min) → 429', async () => {
  const c = client();
  await c.post('/api/auth/register', { email: 'rl-login@test.fr', password: 'motdepasse123' });
  let last;
  for (let i = 0; i < 11; i++) {
    last = await c.post('/api/auth/login', { email: 'rl-login@test.fr', password: 'mauvais-mdp-xxx' });
  }
  assert.equal(last.status, 429, JSON.stringify(last.data));
  assert.ok(Number(last.headers.get('retry-after')) > 0);
});
