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
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const result = await query(
      'SELECT id, username, is_premium FROM users WHERE id = $1',
      [payload.id]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = result.rows[0];
    req.user = { id: user.id, username: user.username, isPremium: !!user.is_premium };
    next();
  } catch (err) {
    console.error('auth middleware error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { auth };

