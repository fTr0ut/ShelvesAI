const { query, transaction } = require('../pg');

/**
 * Find user by email
 */
async function findByEmail(email) {
    const result = await query(
        'SELECT * FROM users WHERE email = $1',
        [email.toLowerCase()]
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
 * Find user by username
 */
async function findByUsername(username) {
    const result = await query(
        'SELECT * FROM users WHERE username = $1',
        [username.toLowerCase()]
    );
    return result.rows[0] || null;
}

/**
 * Create new user
 */
async function create({ email, passwordHash, username }) {
    const result = await query(
        `INSERT INTO users (email, password_hash, username)
     VALUES ($1, $2, $3)
     RETURNING *`,
        [email.toLowerCase(), passwordHash, username?.toLowerCase() || null]
    );
    return result.rows[0];
}

/**
 * Update user profile
 */
async function updateProfile(id, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    const allowedFields = [
        'username', 'first_name', 'last_name', 'phone_number',
        'picture', 'country', 'state', 'city', 'is_private'
    ];

    for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
            fields.push(`${key} = $${paramIndex}`);
            values.push(value);
            paramIndex++;
        }
    }

    if (fields.length === 0) return findById(id);

    values.push(id);
    const result = await query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
    );
    return result.rows[0];
}

module.exports = {
    findByEmail,
    findById,
    findByUsername,
    create,
    updateProfile,
};
