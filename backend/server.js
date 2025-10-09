const path = require('path');
const { pathToFileURL } = require('url');
// Load .env from this folder explicitly so it works no matter CWD
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const cookie = require('cookie');
const signature = require('cookie-signature');
const { createProxyMiddleware } = require('http-proxy-middleware');

const authRoutes = require('./routes/auth');
const shelvesRoutes = require('./routes/shelves');
const accountRoutes = require('./routes/account');
const collectablesRoutes = require('./routes/collectables');
const feedRoutes = require('./routes/feed');
const friendsRoutes = require('./routes/friends');
const steamRoutes = require('./routes/steam');
const steamOpenIdRoutes = require('./routes/steamOpenId');
const plasmicRoutes = require('./routes/plasmic');
const uiEditorRoutes = require('./routes/uiEditor');

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
  'https://studio.plasmic.app',
  'https://app.tryplasmic.com',
  'https://host.plasmic.app',
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
const plasmicHostOrigin = (process.env.PLASMIC_HOST_ORIGIN || '').trim();

if (plasmicHostOrigin) {
  console.log(`Proxying /plasmic-host to ${plasmicHostOrigin}`);
  app.use(
    '/plasmic-host',
    createProxyMiddleware({
      target: plasmicHostOrigin,
      changeOrigin: true,
      pathRewrite: (path, req) => {
        const source = req.originalUrl || path || '/';
        const rewritten = source.replace(/^\/plasmic-host/, '');
        if (!rewritten) return '/';
        return rewritten.startsWith('/') ? rewritten : `/${rewritten}`;
      },
      onError(err, _req, res) {
        console.error('Proxy error for /plasmic-host:', err.message);
        if (!res.headersSent) {
          res.status(502).send('Proxy Error');
        } else {
          res.end();
        }
      },
    })
  );
} else {
  setupLocalPlasmicHost(app).catch((err) => {
    console.error('Failed to initialize local Plasmic host:', err);
  });
}
async function setupLocalPlasmicHost(expressApp) {
  const hostRoot = path.join(__dirname, '..', 'plasmic-host');
  const distDir = path.join(hostRoot, 'dist');
  const indexFile = path.join(distDir, 'index.html');
  const useDevServer =
    process.env.NODE_ENV !== 'production' && process.env.PLASMIC_HOST_STATIC_ONLY !== 'true';

  const loadVite = async () => {
    try {
      return await import('vite');
    } catch (rootErr) {
      const fallbackEntry = path.join(hostRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js');
      if (fs.existsSync(fallbackEntry)) {
        return import(pathToFileURL(fallbackEntry).href);
      }
      throw rootErr;
    }
  };

  if (useDevServer) {
    try {
      const { createServer: createViteServer } = await loadVite();
      const enableHmr = process.env.PLASMIC_HOST_ENABLE_HMR === 'true';
      const remoteHost = process.env.PLASMIC_REMOTE_HOST || 'https://host.plasmic.app';

      expressApp.use(
        '/plasmic-host/api',
        createProxyMiddleware({
          target: remoteHost,
          changeOrigin: true,
          pathRewrite: { '^/plasmic-host': '' },
          logLevel: process.env.PLASMIC_PROXY_LOG_LEVEL || 'warn',
        })
      );

      const vite = await createViteServer({
        root: hostRoot,
        base: '/plasmic-host/',
        server: { middlewareMode: true, hmr: enableHmr ? undefined : false },
        appType: 'spa',
        logLevel: process.env.VITE_LOG_LEVEL || 'info',
      });

      expressApp.use('/plasmic-host', (req, res, next) => {
        const originalUrl = req.originalUrl || req.url;
        req.url = originalUrl.replace(/^\/plasmic-host/, '') || '/';
        vite.middlewares(req, res, next);
      });

      console.log('Plasmic host dev server mounted via Vite middleware.');
      return;
    } catch (err) {
      console.warn(`Failed to start Plasmic host dev server: ${err.message}`);
    }
  }

  if (fs.existsSync(distDir) && fs.existsSync(indexFile)) {
    console.log(`Serving Plasmic host static build from ${distDir}`);
    const remoteHost = process.env.PLASMIC_REMOTE_HOST || 'https://host.plasmic.app';
    expressApp.use(
      '/plasmic-host/api',
      createProxyMiddleware({
        target: remoteHost,
        changeOrigin: true,
        pathRewrite: { '^/plasmic-host': '' },
        logLevel: process.env.PLASMIC_PROXY_LOG_LEVEL || 'warn',
      })
    );
    expressApp.use('/plasmic-host', express.static(distDir, { index: 'index.html', fallthrough: true }));
    expressApp.get('/plasmic-host*', (_req, res) => {
      res.sendFile(indexFile);
    });
  } else {
    console.warn(
      'No Plasmic host build found. Run "npm run build" inside /plasmic-host to generate the static assets.'
    );
  }
}

app.use(express.json({ limit: '10mb' }));    // parse JSON bodies

const mediaRoot = path.join(__dirname, 'cache');
try {
  if (!fs.existsSync(mediaRoot)) {
    fs.mkdirSync(mediaRoot, { recursive: true });
  }
  app.use('/media', express.static(mediaRoot));
} catch (err) {
  console.warn('Failed to initialize media cache directory:', err.message);
}

// DB connection
// if (process.env.MONGO_URI) {
//   mongoose
//     .connect(process.env.MONGO_URI)
//     .then(() => console.log('MongoDB connected'))
//     .catch((err) => console.error('MongoDB connection error:', err));
// } else {
//   console.warn('MONGO_URI not set. Skipping DB connection.');
// }



// Routes
app.use('/api', authRoutes);
app.use('/api/shelves', shelvesRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/collectables', collectablesRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/ui-editor', uiEditorRoutes);
app.use('/steam', steamOpenIdRoutes);
app.use('/api/steam', steamRoutes);
app.use('/', plasmicRoutes);
// Optional: Auth0-protected example route when configured
try {
  const { auth: auth0Jwt } = require('express-oauth2-jwt-bearer');
  const rawDomain = (process.env.AUTH0_DOMAIN || '').trim();
  const audience = (process.env.AUTH0_AUDIENCE || '').trim();
  // Normalize issuer: accept either bare domain (your-tenant.us.auth0.com) or full https URL
  const issuerBaseURL = rawDomain
    ? (rawDomain.startsWith('http') ? rawDomain.replace(/\/+$/, '') : `https://${rawDomain}`)
    : '';
  if (issuerBaseURL && audience) {
    console.log(`Auth0 config → issuer: ${issuerBaseURL} audience: ${audience}`);
    const checkJwt = auth0Jwt({
      audience,
      issuerBaseURL,
      tokenSigningAlg: 'RS256',
    });
    app.get('/api/auth0/me', checkJwt, (req, res) => {
      // When valid, req.auth contains token claims
      res.json({ auth0: req.auth });
    });
    // consumeAuth0 -> issues local JWT
    try {
      const { consumeAuth0 } = require('./controllers/authController');
      app.post('/api/auth0/consume', checkJwt, consumeAuth0);
    } catch {}
    // Optional: sync minimal Auth0 profile into Mongo
    try {
      const Auth0Profile = require('./models/Auth0Profile');
      app.post('/api/auth0/sync', checkJwt, async (req, res) => {
        const claims = req.auth?.payload || {};
        if (!claims.sub) return res.status(400).json({ error: 'Missing sub in token' });
        const update = {
          email: claims.email,
          name: claims.name || claims.nickname,
          picture: claims.picture,
        };
        const doc = await Auth0Profile.findOneAndUpdate(
          { sub: claims.sub },
          { sub: claims.sub, ...update },
          { upsert: true, new: true }
        );
        res.json({ synced: true, profile: { id: doc._id, sub: doc.sub, email: doc.email, name: doc.name } });
      });
      console.log('Auth0 routes enabled at /api/auth0/me and /api/auth0/sync');
    } catch {}
    console.log('Auth0 route enabled at /api/auth0/me');
  } else {
    console.log('Auth0 not configured (set AUTH0_DOMAIN and AUTH0_AUDIENCE).');
  }
} catch (e) {
  // Module not installed; skip silently
}

// Serve frontend build with optional env override
const distPath = process.env.FRONTEND_DIST || path.join(__dirname, '..', 'frontend', 'dist');
const indexPath = path.join(distPath, 'index.html');

if (fs.existsSync(distPath)) {
  console.log(`Serving frontend from: ${distPath}`);
  console.log(`Index at: ${indexPath} (exists: ${fs.existsSync(indexPath)})`);
  // Serve root explicitly
  app.get('/', (req, res) => {
    res.sendFile(indexPath);
  });
  // Also handle /index.html explicitly
  app.get('/index.html', (req, res) => {
    res.sendFile(indexPath);
  });
  // Serve static assets
  app.use(express.static(distPath));
  // SPA fallback: send index.html for non-API routes
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/steam')) {
      return next();
    }
    if (req.path.startsWith('/plasmic-host')) {
      return next();
    }
    res.sendFile(indexPath);
  });
} else {
  console.warn(`Frontend build not found at ${distPath}. Run "npm run build" in /frontend to generate it.`);
}

// Debug route to verify resolved paths
const emitFrontendDiagnostics = (req, res) => {
  const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
  const indexPath = path.join(frontendPath, 'index.html');
  res.json({
    frontendPath,
    frontendExists: fs.existsSync(frontendPath),
    indexPath,
    indexExists: fs.existsSync(indexPath),
    cwd: process.cwd(),
    dirname: __dirname,
  });
};

app.get('/__debug', emitFrontendDiagnostics);
app.get('/api/__debug', emitFrontendDiagnostics);
module.exports = app;





