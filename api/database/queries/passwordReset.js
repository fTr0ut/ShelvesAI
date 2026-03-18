const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query, transaction } = require('../pg');

/**
 * Generate a secure random token for password reset.
 * @returns {string} A 64-character hex token
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a password reset token for a user.
 * Invalidates any existing tokens for the user.
 * @param {string} userId - User ID
 * @returns {Promise<{token: string, expiresAt: Date}>}
 */
async function createResetToken(userId) {
    // Invalidate any existing tokens for this user
    await query(
        `UPDATE password_reset_tokens
         SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId]
    );

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, token, expiresAt]
    );

    return { token, expiresAt };
}

/**
 * Validate a password reset token and return the associated user ID.
 * @param {string} token - The reset token
 * @returns {Promise<{valid: boolean, userId?: string, error?: string}>}
 */
async function validateResetToken(token) {
    const result = await query(
        `SELECT prt.user_id, prt.expires_at, prt.used_at, u.email
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
         WHERE prt.token = $1`,
        [token]
    );

    if (result.rows.length === 0) {
        return { valid: false, error: 'Invalid reset token' };
    }

    const row = result.rows[0];

    if (row.used_at) {
        return { valid: false, error: 'Reset token has already been used' };
    }

    if (new Date(row.expires_at) < new Date()) {
        return { valid: false, error: 'Reset token has expired' };
    }

    return { valid: true, userId: row.user_id, email: row.email };
}

/**
 * Reset password using a valid token.
 * @param {string} token - The reset token
 * @param {string} newPassword - The new password (plaintext)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function resetPassword(token, newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, 10);

    return transaction(async (client) => {
        // Atomically consume a valid, unused token and fetch its user.
        const consumeResult = await client.query(
            `UPDATE password_reset_tokens
             SET used_at = NOW()
             WHERE token = $1
               AND used_at IS NULL
               AND expires_at > NOW()
             RETURNING user_id`,
            [token]
        );

        if (consumeResult.rows.length === 0) {
            const validation = await validateResetToken(token);
            return { success: false, error: validation.error || 'Invalid reset token' };
        }

        await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
            passwordHash,
            consumeResult.rows[0].user_id,
        ]);

        return { success: true };
    });
}

/**
 * Clean up expired tokens (call periodically).
 */
async function cleanupExpiredTokens() {
    const result = await query(
        `DELETE FROM password_reset_tokens
         WHERE expires_at < NOW() - INTERVAL '24 hours'`
    );
    return result.rowCount;
}

module.exports = {
    generateToken,
    createResetToken,
    validateResetToken,
    resetPassword,
    cleanupExpiredTokens,
};
