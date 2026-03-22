const jwt = require('jsonwebtoken');
const { query } = require('../database/pg');
const { ADMIN_AUTH_COOKIE } = require('../utils/adminAuth');
const { AUTH_CACHE_TTL_MS, AUTH_CACHE_MAX_ENTRIES } = require('../config/constants');
const { setUserId } = require('../context');
const logger = require('../logger');
const authCache = new Map();

// In-memory set of revoked JWT IDs (jti). Entries auto-expire so the set
// doesn't grow unbounded — we only need to track tokens until their natural
// JWT expiry (max 7d for user tokens, 2h for admin tokens).
const revokedTokens = new Map();

function revokeToken(jti, expiresAt) {
  if (!jti) return;
  revokedTokens.set(jti, expiresAt);
  // Lazy cleanup: purge expired entries when set grows large
  if (revokedTokens.size > 5000) {
    const now = Math.floor(Date.now() / 1000);
    for (const [id, exp] of revokedTokens) {
      if (exp <= now) revokedTokens.delete(id);
    }
  }
}

function isTokenRevoked(jti) {
  if (!jti) return false;
  const exp = revokedTokens.get(jti);
  if (exp === undefined) return false;
  if (exp <= Math.floor(Date.now() / 1000)) {
    revokedTokens.delete(jti);
    return false;
  }
  return true;
}

function getCachedUser(userId) {
  if (AUTH_CACHE_TTL_MS <= 0) return null;
  const entry = authCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    authCache.delete(userId);
    return null;
  }

  // Touch entry on read to preserve true LRU ordering.
  authCache.delete(userId);
  authCache.set(userId, entry);

  return entry.user;
}

function setCachedUser(userId, user) {
  if (AUTH_CACHE_TTL_MS <= 0 || AUTH_CACHE_MAX_ENTRIES <= 0) return;
  if (authCache.has(userId)) {
    authCache.delete(userId);
  }

  authCache.set(userId, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });

  // Evict least recently used entries while over capacity.
  while (authCache.size > AUTH_CACHE_MAX_ENTRIES) {
    const oldestKey = authCache.keys().next().value;
    if (oldestKey === undefined) break;
    authCache.delete(oldestKey);
  }
}

async function auth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const [scheme, token] = header.split(' ');
  const cookieToken = req.cookies?.[ADMIN_AUTH_COOKIE];
  const resolvedToken = (scheme === 'Bearer' && token) ? token : cookieToken;
  if (!resolvedToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let payload;
  try {
    payload = jwt.verify(resolvedToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (isTokenRevoked(payload.jti)) {
    return res.status(401).json({ error: 'Token revoked' });
  }

  try {
    let user = getCachedUser(payload.id);

    if (!user) {
      const result = await query(
        'SELECT id, username, is_premium, is_admin, is_suspended, suspension_reason FROM users WHERE id = $1',
        [payload.id]
      );

      if (!result.rows.length) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      user = result.rows[0];
      setCachedUser(payload.id, user);
    }


    // Check if user is suspended
    if (user.is_suspended) {
      return res.status(403).json({
        error: 'Account suspended',
        code: 'ACCOUNT_SUSPENDED',
        reason: user.suspension_reason || null,
      });
    }

    req.user = {
      id: user.id,
      username: user.username,
      isPremium: !!user.is_premium,
      isAdmin: !!user.is_admin,
    };
    req.tokenType = payload.type || 'user';
    setUserId(user.id);
    next();
  } catch (err) {
    logger.error('auth middleware error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Optional auth middleware - sets req.user if valid token present, but doesn't require it
 */
async function optionalAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const [scheme, token] = header.split(' ');

  // No token provided - continue without user
  if (scheme !== 'Bearer' || !token) {
    req.user = null;
    return next();
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    // Invalid token - continue without user
    req.user = null;
    return next();
  }

  try {
    let user = getCachedUser(payload.id);

    if (!user) {
      const result = await query(
        'SELECT id, username, is_premium, is_admin, is_suspended, suspension_reason FROM users WHERE id = $1',
        [payload.id]
      );

      if (result.rows.length) {
        user = result.rows[0];
        setCachedUser(payload.id, user);
      }
    }

    if (!user) {
      req.user = null;
      return next();
    }

    // For optional auth, suspended users are treated as unauthenticated
    if (user.is_suspended) {
      req.user = null;
    } else {
      req.user = {
        id: user.id,
        username: user.username,
        isPremium: !!user.is_premium,
        isAdmin: !!user.is_admin,
      };
      setUserId(user.id);
    }
    next();
  } catch (err) {
    logger.error('optionalAuth middleware error:', err);
    req.user = null;
    next();
  }
}

/**
 * Remove a user from the auth cache so the next request hits the DB.
 * Call this when a user's admin/suspension status changes.
 */
function invalidateAuthCache(userId) {
  authCache.delete(userId);
}

module.exports = { auth, optionalAuth, revokeToken, invalidateAuthCache };
