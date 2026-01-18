const path = require('path');
// Load .env from this folder explicitly so it works no matter CWD
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const cookie = require('cookie');
const signature = require('cookie-signature');

const authRoutes = require('./routes/auth');
const shelvesRoutes = require('./routes/shelves');
const accountRoutes = require('./routes/account');
const collectablesRoutes = require('./routes/collectables');
const feedRoutes = require('./routes/feed');
const friendsRoutes = require('./routes/friends');
const profileRoutes = require('./routes/profile');
const wishlistsRoutes = require('./routes/wishlists');
const favoritesRoutes = require('./routes/favorites');
const listsRoutes = require('./routes/lists');
const unmatchedRoutes = require('./routes/unmatched');
const onboardingRoutes = require('./routes/onboarding');
const configRoutes = require('./routes/config');
const checkinRoutes = require('./routes/checkin');
const notificationsRoutes = require('./routes/notifications');
const ratingsRoutes = require('./routes/ratings');
// Steam routes temporarily disabled - need PostgreSQL migration
// const steamRoutes = require('./routes/steam');
// const steamOpenIdRoutes = require('./routes/steamOpenId');

const app = express();

// Minimal request log (dev only)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const contentLength = res.get('Content-Length') || 0;
      const logLine = [
        req.ip,
        req.method,
        req.originalUrl,
        res.statusCode,
        `${contentLength}b`,
        `${durationMs.toFixed(2)}ms`,
        req.get('referer') || '-',
        req.get('user-agent') || '-',
      ].join(' | ');

      console.log(logLine);
    });

    next();
  });
}

const defaultCorsOrigins = [
  'http://localhost:3000',
  'http://localhost:5001',
  'http://localhost:5173',
  'https://nonresilient-rylan-nondebilitating.ngrok-free.dev'
];

const envCorsOrigins = [];
if (process.env.FRONTEND_URL) envCorsOrigins.push(process.env.FRONTEND_URL.trim());
if (process.env.NEXT_PUBLIC_SITE_URL) envCorsOrigins.push(process.env.NEXT_PUBLIC_SITE_URL.trim());
if (process.env.CORS_ORIGINS) {
  envCorsOrigins.push(
    ...process.env.CORS_ORIGINS.split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}
if (process.env.VERCEL_URL) {
  const normalized = process.env.VERCEL_URL.trim().replace(/^https?:\/\//i, '');
  if (normalized) envCorsOrigins.push(`https://${normalized}`);
}

const corsAllowList = Array.from(new Set([...defaultCorsOrigins, ...envCorsOrigins]));

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (corsAllowList.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`Blocked CORS origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  exposedHeaders: ['Content-Length', 'Content-Range', 'X-Total-Count'],
};

const corsMiddleware = cors(corsOptions);
app.use(corsMiddleware);
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
app.use((req, _res, next) => {
  const secret =
    process.env.COOKIE_SECRET || process.env.JWT_SECRET || 'collector-cookie-secret';
  req.secret = secret;

  const header = req.headers?.cookie;
  const parsed = header ? cookie.parse(header) : {};
  const cookies = {};
  const signedCookies = {};

  for (const [name, value] of Object.entries(parsed)) {
    let decodedValue = value;
    if (secret && typeof value === 'string' && value.startsWith('s:')) {
      const unsigned = signature.unsign(value.slice(2), secret);
      if (unsigned !== false) {
        signedCookies[name] = value;
        decodedValue = unsigned;
      }
    }
    cookies[name] = decodedValue;
  }

  req.cookies = cookies;
  req.signedCookies = signedCookies;
  next();
});

app.use(express.json({ limit: '10mb' }));

const rawMediaRoot =
  process.env.MEDIA_CACHE_DIR ||
  process.env.COVER_CACHE_DIR ||
  path.join(__dirname, 'cache');
const mediaRoot = path.isAbsolute(rawMediaRoot)
  ? rawMediaRoot
  : path.resolve(__dirname, rawMediaRoot);
try {
  if (!fs.existsSync(mediaRoot)) {
    fs.mkdirSync(mediaRoot, { recursive: true });
  }
  app.use('/media', express.static(mediaRoot, {
    maxAge: '1y',
    immutable: true
  }));
} catch (err) {
  console.warn('Failed to initialize media cache directory:', err.message);
}

// Routes
app.use('/api', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/shelves', shelvesRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/collectables', collectablesRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/wishlists', wishlistsRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/lists', listsRoutes);
app.use('/api/unmatched', unmatchedRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/config', configRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/ratings', ratingsRoutes);

app.use((err, _req, res, next) => {
  if (err && (err.status === 413 || err.statusCode === 413 || err.type === 'entity.too.large')) {
    return res.status(413).json({
      error: 'Image too large. Please try taking another photo or use a lower quality setting.',
      code: 'image_too_large',
    });
  }
  next(err);
});

module.exports = app;
