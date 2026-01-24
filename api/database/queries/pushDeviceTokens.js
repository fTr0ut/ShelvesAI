const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

/**
 * Register or update a push device token for a user
 * Uses upsert to handle re-registration of same token
 */
async function registerToken(userId, expoPushToken, options = {}) {
    const { deviceId = null, platform = null } = options;

    const result = await query(
        `INSERT INTO push_device_tokens (user_id, expo_push_token, device_id, platform, is_active, last_used_at)
         VALUES ($1, $2, $3, $4, true, NOW())
         ON CONFLICT (user_id, expo_push_token)
         DO UPDATE SET
             is_active = true,
             device_id = COALESCE(EXCLUDED.device_id, push_device_tokens.device_id),
             platform = COALESCE(EXCLUDED.platform, push_device_tokens.platform),
             last_used_at = NOW(),
             updated_at = NOW()
         RETURNING *`,
        [userId, expoPushToken, deviceId, platform]
    );

    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Get all active push tokens for a user
 */
async function getTokensForUser(userId) {
    const result = await query(
        `SELECT * FROM push_device_tokens
         WHERE user_id = $1 AND is_active = true
         ORDER BY last_used_at DESC NULLS LAST`,
        [userId]
    );

    return result.rows.map(rowToCamelCase);
}

/**
 * Deactivate a token (mark as inactive, typically when Expo returns DeviceNotRegistered)
 */
async function deactivateToken(expoPushToken) {
    const result = await query(
        `UPDATE push_device_tokens
         SET is_active = false, updated_at = NOW()
         WHERE expo_push_token = $1
         RETURNING id`,
        [expoPushToken]
    );

    return result.rowCount > 0;
}

/**
 * Remove a token for a user (on logout)
 */
async function removeToken(userId, expoPushToken) {
    const result = await query(
        `DELETE FROM push_device_tokens
         WHERE user_id = $1 AND expo_push_token = $2
         RETURNING id`,
        [userId, expoPushToken]
    );

    return result.rowCount > 0;
}

/**
 * Remove all tokens for a user (on account deletion or full logout)
 */
async function removeAllTokensForUser(userId) {
    const result = await query(
        `DELETE FROM push_device_tokens
         WHERE user_id = $1
         RETURNING id`,
        [userId]
    );

    return result.rowCount;
}

/**
 * Update last_used_at timestamp for a token
 */
async function touchToken(expoPushToken) {
    await query(
        `UPDATE push_device_tokens
         SET last_used_at = NOW(), updated_at = NOW()
         WHERE expo_push_token = $1 AND is_active = true`,
        [expoPushToken]
    );
}

module.exports = {
    registerToken,
    getTokensForUser,
    deactivateToken,
    removeToken,
    removeAllTokensForUser,
    touchToken,
};
