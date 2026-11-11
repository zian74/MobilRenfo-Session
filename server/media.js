import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');

export const ALLOWED_MEDIA = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export const MAX_MEDIA_SIZE = 25 * 1024 * 1024;

export function mediaKeyFromUrl(url) {
  const m = /^\/api\/media\/([a-f0-9]{32})$/.exec(String(url || ''));
  return m ? m[1] : null;
}

export function extFromFilename(filename) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(filename || ''));
  return m ? m[1].toLowerCase() : '';
}

export function saveMediaFile(userId, filename, mimeHint, buffer) {
  const ext = extFromFilename(filename);
  const mime = ALLOWED_MEDIA[ext];
  if (!mime) {
    const err = new Error('Type de média non autorisé (png, jpg, gif, webp, mp4, webm, mov)');
    err.status = 400;
    throw err;
  }
  if (!buffer || buffer.length === 0) {
    const err = new Error('Fichier vide');
    err.status = 400;
    throw err;
  }
  if (buffer.length > MAX_MEDIA_SIZE) {
    const err = new Error('Fichier trop volumineux (25 Mo max)');
    err.status = 413;
    throw err;
  }
  const key = crypto.randomBytes(16).toString('hex');
  const userDir = path.join(UPLOAD_DIR, `u${userId}`);
  fs.mkdirSync(userDir, { recursive: true });
  const filePath = path.join(userDir, `${key}.${ext}`);
  fs.writeFileSync(filePath, buffer);
  getDb().prepare('INSERT INTO media (key, user_id, filename, mime, size) VALUES (?, ?, ?, ?, ?)')
    .run(key, userId, path.basename(filename).slice(0, 200), mime, buffer.length);
  return { key, mime, size: buffer.length, url: `/api/media/${key}`, filePath };
}

export function mediaRow(key) {
  return getDb().prepare('SELECT * FROM media WHERE key = ?').get(key);
}

export function mediaFilePathFor(row) {
  const ext = Object.entries(ALLOWED_MEDIA).find(([, m]) => m === row.mime)?.[0] || 'bin';
  return path.join(UPLOAD_DIR, `u${row.user_id}`, `${row.key}.${ext}`);
}

export function deleteMediaByKey(key, userId) {
  const row = mediaRow(key);
  if (!row || (userId !== undefined && row.user_id !== userId)) return false;
  try { fs.unlinkSync(mediaFilePathFor(row)); } catch { /* déjà supprimé */ }
  getDb().prepare('DELETE FROM media WHERE key = ?').run(key);
  return true;
}

export function deleteAllMediaForUser(userId) {
  const rows = getDb().prepare('SELECT * FROM media WHERE user_id = ?').all(userId);
  for (const row of rows) {
    try { fs.unlinkSync(mediaFilePathFor(row)); } catch { /* ignore */ }
  }
  getDb().prepare('DELETE FROM media WHERE user_id = ?').run(userId);
  try { fs.rmSync(path.join(UPLOAD_DIR, `u${userId}`), { recursive: true, force: true }); } catch { /* ignore */ }
}
