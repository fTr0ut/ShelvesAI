const authQueries = require('../database/queries/auth');

// POST /api/login
async function login(req, res) {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const result = await authQueries.login({ username, password });
    if (!result) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    return res.json(result);
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// POST /api/register
async function register(req, res) {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const result = await authQueries.register({ username, password });
    return res.status(201).json({
      message: 'User created',
      user: result.user,
      token: result.token
    });
  } catch (err) {
    // Unique constraint violation (username taken)
    if (err?.code === '23505') {
      return res.status(400).json({ error: 'Username taken' });
    }
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Server error', details: err.message, stack: err.stack });
  }
}

// GET /api/me (local JWT)
async function me(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });

    const user = await authQueries.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        picture: user.picture,
      }
    });
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// POST /api/auth0/consume (Auth0 access token verified by middleware)
async function consumeAuth0(req, res) {
  try {
    const claims = req.auth?.payload || {};
    const sub = claims.sub;
    if (!sub) return res.status(400).json({ error: 'Missing sub in token' });

    const result = await authQueries.findOrCreateByAuth0({
      sub,
      email: claims.email,
      name: claims.name || claims.nickname,
      picture: claims.picture,
    });

    return res.json(result);
  } catch (err) {
    console.error('consumeAuth0 error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// POST /api/username (local JWT) — set or change username
async function setUsername(req, res) {
  try {
    const { username } = req.body ?? {};
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Invalid username' });
    }
    const trimmed = username.trim();
    if (!trimmed) return res.status(400).json({ error: 'Invalid username' });

    const result = await authQueries.setUsername(req.user.id, trimmed);

    if (result.error) {
      const status = result.error === 'Username taken' ? 409 : 400;
      return res.status(status).json({ error: result.error });
    }

    return res.json(result);
  } catch (err) {
    console.error('setUsername error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { login, register, me, consumeAuth0, setUsername };
