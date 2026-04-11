const { query, transaction } = require('../pg');
const { rowToCamelCase } = require('./utils');

const INSTALLATION_DEVICE_ID_PREFIX = 'install:';

/**
 * Register or update a push device token for a user
 * Uses upsert to handle re-registration of same token
 */
async function registerToken(userId, expoPushToken, options = {}) {
    const normalizedDeviceId = typeof options.deviceId === 'string' && options.deviceId.trim()
        ? options.deviceId.trim()
        : null;
    const normalizedPlatform = typeof options.platform === 'string' && options.platform.trim()
        ? options.platform.trim()
        : null;

    return transaction(async (client) => {
        const upsertResult = await client.query(
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
            [userId, expoPushToken, normalizedDeviceId, normalizedPlatform]
        );

        if (normalizedDeviceId) {
            if (normalizedDeviceId.startsWith(INSTALLATION_DEVICE_ID_PREFIX)) {
                // Keep one active token per installation, and opportunistically retire pre-installation legacy rows.
                await client.query(
                    `UPDATE push_device_tokens
                     SET is_active = false, updated_at = NOW()
                     WHERE user_id = $1
                       AND expo_push_token != $2
                       AND is_active = true
                       AND (
                           device_id = $3
                           OR device_id IS NULL
                           OR device_id NOT LIKE 'install:%'
                       )`,
                    [userId, expoPushToken, normalizedDeviceId]
                );
            } else {
                await client.query(
                    `UPDATE push_device_tokens
                     SET is_active = false, updated_at = NOW()
                     WHERE user_id = $1
                       AND expo_push_token != $2
                       AND is_active = true
                       AND device_id = $3`,
                    [userId, expoPushToken, normalizedDeviceId]
                );
            }
        } else {
            // Backward compatibility fallback for clients that still omit device IDs.
            await client.query(
                `UPDATE push_device_tokens
                 SET is_active = false, updated_at = NOW()
                 WHERE user_id = $1
                   AND expo_push_token != $2
                   AND is_active = true`,
                [userId, expoPushToken]
            );
        }

        return upsertResult.rows[0] ? rowToCamelCase(upsertResult.rows[0]) : null;
    });
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
 * Get all active push tokens across all users (for broadcast sends)
 */
async function getAllActiveTokens() {
    const result = await query(
        `SELECT expo_push_token FROM push_device_tokens WHERE is_active = true`
    );
    return result.rows.map(rowToCamelCase);
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
    getAllActiveTokens,
    deactivateToken,
    removeToken,
    removeAllTokensForUser,
    touchToken,
};
