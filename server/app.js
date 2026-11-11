import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireMutationSafety } from './auth.js';
import authRoutes from './routes/auth.routes.js';
import exerciseRoutes from './routes/exercises.routes.js';
import sessionRoutes from './routes/sessions.routes.js';
import plannedRoutes from './routes/planned.routes.js';
import historyRoutes from './routes/history.routes.js';
import mediaRoutes from './routes/media.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.raw({ type: ['image/*', 'video/*'], limit: '25mb' }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(requireMutationSafety);

  app.use('/api/auth', authRoutes);
  app.use('/api/exercises', exerciseRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/planned', plannedRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api', historyRoutes);

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Route inconnue' });
    }
    next();
  });

  if (fs.existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });
  }

  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON invalide' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Charge utile trop volumineuse' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur interne' });
  });

  return app;
}
