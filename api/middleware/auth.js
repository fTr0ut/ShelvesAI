const jwt = require('jsonwebtoken');
const { query } = require('../database/pg');

const AUTH_CACHE_TTL_MS = process.env.AUTH_CACHE_TTL_MS ? parseInt(process.env.AUTH_CACHE_TTL_MS, 10) : 5000;
const AUTH_CACHE_MAX_ENTRIES = process.env.AUTH_CACHE_MAX ? parseInt(process.env.AUTH_CACHE_MAX, 10) : 1000;
const authCache = new Map();

function getCachedUser(userId) {
  if (AUTH_CACHE_TTL_MS <= 0) return null;
  const entry = authCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    authCache.delete(userId);
    return null;
  }
  return entry.user;
}

function setCachedUser(userId, user) {
  if (AUTH_CACHE_TTL_MS <= 0) return;
  authCache.set(userId, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });

  // Prevent unbounded growth in long-lived dev sessions
  if (authCache.size > AUTH_CACHE_MAX_ENTRIES) {
    const oldestKey = authCache.keys().next().value;
    if (oldestKey) authCache.delete(oldestKey);
  }
}

async function auth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
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
    next();
  } catch (err) {
    console.error('auth middleware error:', err);
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
    }
    next();
  } catch (err) {
    console.error('optionalAuth middleware error:', err);
    req.user = null;
    next();
  }
}

module.exports = { auth, optionalAuth };

