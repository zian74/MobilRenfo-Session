import { Router } from 'express';
import fs from 'node:fs';
import { requireAuth, apiError } from '../auth.js';
import { saveMediaFile, mediaRow, mediaFilePathFor, deleteMediaByKey, MAX_MEDIA_SIZE } from '../media.js';

const router = Router();
router.use(requireAuth);

router.post('/upload', (req, res) => {
  try {
    const ct = String(req.headers['content-type'] || '');
    if (!ct.startsWith('image/') && !ct.startsWith('video/')) {
      return apiError(res, 415, 'Seuls les images et vidéos sont acceptées');
    }
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer) return apiError(res, 400, 'Corps de requête manquant');
    if (buffer.length > MAX_MEDIA_SIZE) return apiError(res, 413, 'Fichier trop volumineux (25 Mo max)');
    const filename = String(req.query.filename || 'media');
    const saved = saveMediaFile(req.user.id, filename, ct, buffer);
    res.status(201).json(saved);
  } catch (e) {
    if (e.status) return apiError(res, e.status, e.message);
    throw e;
  }
});

router.get('/:key', (req, res) => {
  const row = mediaRow(req.params.key);
  if (!row || row.user_id !== req.user.id) return apiError(res, 404, 'Média introuvable');
  const filePath = mediaFilePathFor(row);
  if (!fs.existsSync(filePath)) return apiError(res, 404, 'Fichier introuvable');
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath);
});

router.delete('/:key', (req, res) => {
  if (!deleteMediaByKey(req.params.key, req.user.id)) return apiError(res, 404, 'Média introuvable');
  res.json({ ok: true });
});

export default router;
