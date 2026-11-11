const buckets = new Map();

const PRUNE_EVERY_MS = 60_000;
const timer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < bucket.windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}, PRUNE_EVERY_MS);
timer.unref();

export function rateLimit({ windowMs, max, keyFn, message = 'Trop de requêtes, veuillez réessayer plus tard' }) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { windowMs, hits: [] };
      buckets.set(key, bucket);
    }
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.hits[0] + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message });
    }
    bucket.hits.push(now);
    next();
  };
}

export const loginLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_LOGIN_MAX || 10),
  keyFn: (req) => `auth-login:${req.ip}`,
  message: 'Trop de tentatives de connexion, réessayez dans 15 minutes',
});

export const registerLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_REGISTER_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_REGISTER_MAX || 5),
  keyFn: (req) => `auth-register:${req.ip}`,
  message: 'Trop d’inscriptions depuis cette adresse, réessayez plus tard',
});

export const uploadLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS || 60 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_UPLOAD_MAX || 20),
  keyFn: (req) => `upload:u${req.user?.id ?? req.ip}`,
  message: 'Limite d’upload atteinte (20 fichiers/heure), réessayez plus tard',
});

export const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_API_WINDOW_MS || 5 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_API_MAX || 600),
  keyFn: (req) => `api:${req.user?.id ?? req.ip}`,
  message: 'Trop de requêtes, ralentissez',
});
