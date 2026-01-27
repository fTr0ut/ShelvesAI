const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../pg');
const { rowToCamelCase, formatUserForResponse } = require('./utils');

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
        `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
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
 * Login user with username/password
 * @returns {{ user: object, token: string, suspended?: boolean, suspensionReason?: string } | null}
 */
async function login({ username, password }) {
    const user = await findByUsername(username);
    if (!user) return null;

    // Check if user is suspended before validating password
    if (user.is_suspended) {
        return {
            suspended: true,
            suspensionReason: user.suspension_reason || null,
        };
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return null;

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
    if (!user) return null;

    // Check if user is suspended before validating password
    if (user.is_suspended) {
        return {
            suspended: true,
            suspensionReason: user.suspension_reason || null,
        };
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return null;

    if (!user.is_admin) {
        return { notAdmin: true };
    }

    const token = jwt.sign(
        { id: user.id, username: user.username, admin: true, type: 'admin' },
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
            `INSERT INTO users (email, first_name, picture)
       VALUES ($1, $2, $3)
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

module.exports = {
    findByUsername,
    findByEmail,
    findById,
    register,
    login,
    loginAdmin,
    findOrCreateByAuth0,
    setUsername,
};
