import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireMutationSafety, currentUser } from './auth.js';
import { apiLimiter } from './ratelimit.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
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
  app.use(securityHeaders);
  app.use(requireMutationSafety);
  app.use('/api', (req, _res, next) => {
    req.user = req.user || currentUser(req) || undefined;
    next();
  });
  app.use('/api', apiLimiter);

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
