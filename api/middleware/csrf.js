const crypto = require('crypto');
const { ADMIN_CSRF_COOKIE } = require('../utils/adminAuth');

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
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  return next();
}

module.exports = { requireAdminCsrf };
