const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../pg');
const { rowToCamelCase, formatUserForResponse } = require('./utils');
const logger = require('../../logger');

// Pre-computed hash so bcrypt.compare always runs even for non-existent users,
// preventing timing-based username enumeration.
const DUMMY_HASH = bcrypt.hashSync('__dummy_timing_pad__', 10);

/**
 * Find user by username (case-insensitive)
 */
async function findByUsername(username) {
    const result = await query(
        'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
        [username]
    );
    return result.rows[0] || null;
}

/**
 * Find user by email (case-insensitive)
 */
async function findByEmail(email) {
    const result = await query(
        'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
    );
    return result.rows[0] || null;
}

/**
 * Find a user by login identifier (username or email, case-insensitive).
 * Returns a status so callers can safely reject ambiguous username/email collisions.
 * @param {string} identifier
 * @returns {Promise<{ status: 'found', user: object } | { status: 'ambiguous', users: object[] } | { status: 'not_found' }>}
 */
async function findByLoginIdentifier(identifier) {
    const result = await query(
        `SELECT *
           FROM users
          WHERE LOWER(username) = LOWER($1)
             OR LOWER(email) = LOWER($1)`,
        [identifier]
    );

    if (result.rows.length === 1) {
        return { status: 'found', user: result.rows[0] };
    }

    if (result.rows.length > 1) {
        return { status: 'ambiguous', users: result.rows };
    }

    return { status: 'not_found' };
}

/**
 * Find user by ID
 */
async function findById(id) {
    const result = await query(
        'SELECT * FROM users WHERE id = $1',
        [id]
    );
    return result.rows[0] || null;
}

/**
 * Register a new user
 * @returns {{ user: object, token: string }}
 */
async function register({ username, password, email }) {
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await query(
        `INSERT INTO users (username, email, password_hash, is_premium)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id, username, email, created_at`,
        [username.toLowerCase(), email.toLowerCase(), passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );

    return { user: rowToCamelCase(user), token, onboardingCompleted: false };
}

/**
 * Login user with username-or-email/password using the legacy `username` request field.
 * @returns {{ user: object, token: string, suspended?: boolean, suspensionReason?: string } | null}
 */
async function login({ username, password }) {
    const lookup = await findByLoginIdentifier(username);
    const user = lookup.status === 'found' ? lookup.user : null;

    // Always run bcrypt to prevent timing-based identifier enumeration
    const valid = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
    if (lookup.status === 'ambiguous') {
        logger.warn('Ambiguous login identifier match rejected', {
            loginIdentifier: username,
            matchedUserIds: lookup.users.map((entry) => entry.id),
        });
        return null;
    }
    if (!user || !valid) return null;

    if (user.is_suspended) {
        return {
            suspended: true,
            suspensionReason: user.suspension_reason || null,
        };
    }

    const token = jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );

    return {
        user: { id: user.id, username: user.username },
        token,
        onboardingCompleted: !!user.onboarding_completed,
    };
}

/**
 * Login admin user with username/password
 * @returns {{ user: object, token: string, suspended?: boolean, suspensionReason?: string, notAdmin?: boolean } | null}
 */
async function loginAdmin({ username, password }) {
    const user = await findByUsername(username);

    // Always run bcrypt to prevent timing-based username enumeration
    const valid = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
    if (!user || !valid) return null;

    if (user.is_suspended) {
        return {
            suspended: true,
            suspensionReason: user.suspension_reason || null,
        };
    }

    if (!user.is_admin) {
        return { notAdmin: true };
    }

    const token = jwt.sign(
        { id: user.id, username: user.username, admin: true, type: 'admin', jti: crypto.randomUUID() },
        process.env.JWT_SECRET,
        { expiresIn: '2h' }
    );

    return {
        user: { id: user.id, username: user.username, isAdmin: true },
        token,
        onboardingCompleted: !!user.onboarding_completed,
    };
}

/**
 * Get user for auth0 sub, linking by email if needed
 */
async function findOrCreateByAuth0(claims) {
    const { sub, email, name, picture } = claims;

    // Find by auth0 sub (stored in external identifiers or similar field)
    // For now, we use email-based linking
    let user = null;

    if (email) {
        user = await findByEmail(email);
    }

    if (!user) {
        const result = await query(
            `INSERT INTO users (email, first_name, picture, is_premium)
       VALUES ($1, $2, $3, TRUE)
       RETURNING *`,
            [email?.toLowerCase(), name, picture]
        );
        user = result.rows[0];
    }

    const token = jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );

    return {
        user: formatUserForResponse(user),
        token,
        needsUsername: !user.username,
        onboardingCompleted: !!user.onboarding_completed,
    };
}

/**
 * Update username for user
 */
async function setUsername(userId, username) {
    // Check if username is taken
    const existing = await findByUsername(username);
    if (existing && existing.id !== userId) {
        return { error: 'Username taken' };
    }

    const result = await query(
        `UPDATE users SET username = $1 WHERE id = $2 RETURNING *`,
        [username.toLowerCase(), userId]
    );

    if (result.rows.length === 0) {
        return { error: 'User not found' };
    }

    return { user: formatUserForResponse(result.rows[0]) };
}

/**
 * Issue a fresh JWT for an existing user (used by the refresh endpoint).
 * @param {number} userId
 * @returns {{ token: string } | null}
 */
async function refreshToken(userId) {
    const result = await query(
        'SELECT id, username, is_suspended FROM users WHERE id = $1',
        [userId]
    );
    const user = result.rows[0];
    if (!user) return null;
    if (user.is_suspended) return { suspended: true };

    const token = jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
    return { token };
}

module.exports = {
    findByUsername,
    findByEmail,
    findByLoginIdentifier,
    findById,
    register,
    login,
    loginAdmin,
    findOrCreateByAuth0,
    setUsername,
    refreshToken,
};
