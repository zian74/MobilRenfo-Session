import crypto from 'node:crypto';
import { getDb } from './db.js';

const SESSION_COOKIE = 'mrs_session';
const SESSION_TTL_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function createSession(res, userId) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
  db.prepare(
    "INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(token, userId, expires.toISOString());
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  });
  return token;
}

export function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    getDb().prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
  }
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

export function currentUser(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.expires_at, u.id, u.email, u.name, u.niveau, u.objectifs, u.created_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
    return null;
  }
  db.prepare("UPDATE auth_sessions SET expires_at = ? WHERE token = ?").run(
    new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000).toISOString(),
    token
  );
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    niveau: row.niveau,
    objectifs: JSON.parse(row.objectifs || '[]'),
    createdAt: row.created_at,
  };
}

export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  req.user = user;
  next();
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = req.headers.host;
    return o.host === host;
  } catch {
    return false;
  }
}

export function requireMutationSafety(req, res, next) {
  if (!sameOrigin(req)) {
    return res.status(403).json({ error: 'Origine non autorisée' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) {
      return res.status(415).json({ error: 'Content-Type JSON requis' });
    }
  }
  next();
}

export function apiError(res, status, message) {
  return res.status(status).json({ error: message });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 200;
}

export function str(value, { max = 500, required = false, fallback = '' } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError('Champ requis manquant');
    return fallback;
  }
  const s = String(value).trim();
  if (required && s.length === 0) throw new ValidationError('Champ requis vide');
  if (s.length > max) throw new ValidationError(`Champ trop long (max ${max})`);
  return s;
}

export function intOrNull(value, { min = -1000000, max = 1000000 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError('Valeur entière invalide');
  }
  return n;
}

export function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function strArray(value, { maxItems = 30, maxLen = 60 } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((v) => String(v ?? '').trim().slice(0, maxLen))
    .filter((v) => v.length > 0);
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}
