const crypto = require('crypto');
const { ADMIN_CSRF_COOKIE, getAdminCookieBaseOptions, createCsrfToken } = require('../utils/adminAuth');
const logger = require('../logger');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEquals(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length === 0 || right.length === 0) return false;
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireAdminCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const cookieToken = req.cookies?.[ADMIN_CSRF_COOKIE];
  const headerToken = req.get('x-csrf-token');

  if (!safeEquals(cookieToken, headerToken)) {
    const ip = req.headers['cf-connecting-ip'] || req.ip;
    logger.warn(`[CSRF] Invalid CSRF token on ${req.method} ${req.path} from ${ip}`);
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  // Rotate CSRF token after each state-changing request
  const newCsrf = createCsrfToken();
  res.cookie(ADMIN_CSRF_COOKIE, newCsrf, {
    ...getAdminCookieBaseOptions(),
    httpOnly: false,
  });
  res.set('x-csrf-token', newCsrf);

  return next();
}

module.exports = { requireAdminCsrf };
