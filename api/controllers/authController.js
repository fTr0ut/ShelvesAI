const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// POST /api/login
async function login(req, res) {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ error: 'Wrong password' });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ user: { id: user._id, username: user.username }, token });
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

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed });
    return res.status(201).json({ message: 'User created', user: { id: user._id, username: user.username } });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ error: 'Username taken' });
    }
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// GET /api/me (local JWT)
async function me(req, res) {
  try {
    // req.user is set by auth middleware (id, username)
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    // Optionally refresh from DB to ensure latest data
    const user = await User.findById(req.user.id).select('_id username');
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: { id: user._id, username: user.username } });
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// POST /api/auth0/consume (Auth0 access token verified by middleware)
// Links or creates a user, then issues local JWT
async function consumeAuth0(req, res) {
  try {
    const claims = req.auth?.payload || {};
    const sub = claims.sub;
    if (!sub) return res.status(400).json({ error: 'Missing sub in token' });

    const email = (claims.email || '').toLowerCase() || undefined;
    const name = claims.name || claims.nickname;
    const picture = claims.picture;

    // 1) Find by auth0Sub first
    let user = await User.findOne({ auth0Sub: sub });

    // 2) Link by email if exists and not linked yet
    if (!user && email) {
      const byEmail = await User.findOne({ email });
      if (byEmail && !byEmail.auth0Sub) {
        byEmail.auth0Sub = sub;
        if (!byEmail.name && name) byEmail.name = name;
        if (!byEmail.picture && picture) byEmail.picture = picture;
        user = await byEmail.save();
      }
    }

    // 3) Create if still not found
    if (!user) {
      user = await User.create({ auth0Sub: sub, email, name, picture });
    }

    const needsUsername = !user.username;

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
      needsUsername,
    });
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

    const exists = await User.findOne({ username: trimmed });
    if (exists && String(exists._id) !== String(req.user.id)) {
      return res.status(409).json({ error: 'Username taken' });
    }

    const user = await User.findById(req.user.id).select('_id username email name picture');
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.username = trimmed;
    await user.save();

    return res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
    });
  } catch (err) {
    console.error('setUsername error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { login, register, me, consumeAuth0, setUsername };
