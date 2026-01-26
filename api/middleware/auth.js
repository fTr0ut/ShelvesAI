const jwt = require('jsonwebtoken');
const { query } = require('../database/pg');

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
    const result = await query(
      'SELECT id, username, is_premium, is_admin, is_suspended, suspension_reason FROM users WHERE id = $1',
      [payload.id]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = result.rows[0];

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
    const result = await query(
      'SELECT id, username, is_premium, is_admin, is_suspended FROM users WHERE id = $1',
      [payload.id]
    );

    if (result.rows.length) {
      const user = result.rows[0];
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
    } else {
      req.user = null;
    }
    next();
  } catch (err) {
    console.error('optionalAuth middleware error:', err);
    req.user = null;
    next();
  }
}

module.exports = { auth, optionalAuth };


