const authQueries = require('../database/queries/auth');
const passwordResetQueries = require('../database/queries/passwordReset');
const emailService = require('../services/emailService');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value) {
  return emailPattern.test(value);
}

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

    // Handle suspended user
    if (result.suspended) {
      return res.status(403).json({
        error: 'Account suspended',
        code: 'ACCOUNT_SUSPENDED',
        reason: result.suspensionReason || null,
      });
    }

    return res.json(result);
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// POST /api/admin/login
async function adminLogin(req, res) {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const result = await authQueries.loginAdmin({ username, password });
    if (!result) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    if (result.notAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (result.suspended) {
      return res.status(403).json({
        error: 'Account suspended',
        code: 'ACCOUNT_SUSPENDED',
        reason: result.suspensionReason || null,
      });
    }

    return res.json(result);
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// POST /api/register
async function register(req, res) {
  try {
    const { username, password, email } = req.body ?? {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!username || !password || !normalizedEmail) {
      return res.status(400).json({ error: 'Missing credentials' });
    }
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const result = await authQueries.register({ username, password, email: normalizedEmail });
    return res.status(201).json({
      message: 'User created',
      user: result.user,
      token: result.token,
      onboardingCompleted: result.onboardingCompleted,
    });
  } catch (err) {
    // Unique constraint violation (username taken)
    if (err?.code === '23505') {
      const detail = String(err?.detail || '');
      if (detail.includes('email')) {
        return res.status(400).json({ error: 'Email taken' });
      }
      return res.status(400).json({ error: 'Username taken' });
    }
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Server error' });
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
        onboardingCompleted: !!user.onboarding_completed,
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

// POST /api/auth/forgot-password
async function forgotPassword(req, res) {
  try {
    const { email } = req.body ?? {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Find user by email
    const user = await authQueries.findByEmail(normalizedEmail);

    // Always return success to prevent email enumeration attacks
    if (!user) {
      console.log(`[ForgotPassword] No user found for email: ${normalizedEmail}`);
      return res.json({ message: 'If an account exists, a reset link has been sent' });
    }

    // Create reset token
    const { token } = await passwordResetQueries.createResetToken(user.id);

    // Send email
    try {
      await emailService.sendPasswordResetEmail(
        normalizedEmail,
        token,
        user.first_name
      );
    } catch (emailError) {
      console.error('[ForgotPassword] Failed to send email:', emailError);
      return res.status(500).json({ error: 'Failed to send reset email. Please try again.' });
    }

    return res.json({ message: 'If an account exists, a reset link has been sent' });
  } catch (err) {
    console.error('ForgotPassword error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// POST /api/auth/reset-password
async function resetPassword(req, res) {
  try {
    const { token, password } = req.body ?? {};

    if (!token) {
      return res.status(400).json({ error: 'Reset token is required' });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const result = await passwordResetQueries.resetPassword(token, password);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('ResetPassword error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// GET /api/auth/validate-reset-token
async function validateResetToken(req, res) {
  try {
    const { token } = req.query ?? {};

    if (!token) {
      return res.status(400).json({ valid: false, error: 'Token is required' });
    }

    const result = await passwordResetQueries.validateResetToken(token);
    return res.json(result);
  } catch (err) {
    console.error('ValidateResetToken error:', err);
    return res.status(500).json({ valid: false, error: 'Server error' });
  }
}

module.exports = { login, adminLogin, register, me, consumeAuth0, setUsername, forgotPassword, resetPassword, validateResetToken };
