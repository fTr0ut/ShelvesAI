const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

const DEFAULT_PREFERENCES = {
    pushEnabled: true,
    pushLikes: true,
    pushComments: true,
    pushFriendRequests: true,
    pushFriendAccepts: true,
};

/**
 * Get notification preferences for a user, creating default preferences if none exist
 */
async function getPreferences(userId) {
    // Try to get existing preferences
    let result = await query(
        `SELECT * FROM notification_preferences WHERE user_id = $1`,
        [userId]
    );

    if (result.rows[0]) {
        return rowToCamelCase(result.rows[0]);
    }

    // Create default preferences if none exist
    result = await query(
        `INSERT INTO notification_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING *`,
        [userId]
    );

    // If insert succeeded, return the new row
    if (result.rows[0]) {
        return rowToCamelCase(result.rows[0]);
    }

    // Race condition: another process inserted, fetch again
    result = await query(
        `SELECT * FROM notification_preferences WHERE user_id = $1`,
        [userId]
    );

    return result.rows[0] ? rowToCamelCase(result.rows[0]) : { userId, ...DEFAULT_PREFERENCES };
}

/**
 * Update notification preferences for a user
 * Only updates fields that are provided
 */
async function updatePreferences(userId, updates) {
    const allowedFields = [
        'push_enabled',
        'push_likes',
        'push_comments',
        'push_friend_requests',
        'push_friend_accepts',
    ];

    // Convert camelCase to snake_case and filter allowed fields
    const fieldMap = {
        pushEnabled: 'push_enabled',
        pushLikes: 'push_likes',
        pushComments: 'push_comments',
        pushFriendRequests: 'push_friend_requests',
        pushFriendAccepts: 'push_friend_accepts',
    };

    const setClauses = [];
    const values = [userId];
    let paramIndex = 2;

    for (const [camelKey, snakeKey] of Object.entries(fieldMap)) {
        if (updates[camelKey] !== undefined && allowedFields.includes(snakeKey)) {
            setClauses.push(`${snakeKey} = $${paramIndex}`);
            values.push(updates[camelKey]);
            paramIndex++;
        }
    }

    if (setClauses.length === 0) {
        // No valid updates, return current preferences
        return getPreferences(userId);
    }

    // Use upsert to handle case where preferences don't exist yet
    const result = await query(
        `INSERT INTO notification_preferences (user_id, ${Object.values(fieldMap).join(', ')})
         VALUES ($1, ${Object.keys(fieldMap).map((_, i) => `$${i + 2}`).join(', ')})
         ON CONFLICT (user_id)
         DO UPDATE SET ${setClauses.join(', ')}, updated_at = NOW()
         RETURNING *`,
        [
            userId,
            updates.pushEnabled ?? true,
            updates.pushLikes ?? true,
            updates.pushComments ?? true,
            updates.pushFriendRequests ?? true,
            updates.pushFriendAccepts ?? true,
        ]
    );

    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Check if a specific notification type is enabled for a user
 */
async function isTypeEnabled(userId, type) {
    const prefs = await getPreferences(userId);

    if (!prefs.pushEnabled) {
        return false;
    }

    const typeMap = {
        like: prefs.pushLikes,
        comment: prefs.pushComments,
        friend_request: prefs.pushFriendRequests,
        friend_accept: prefs.pushFriendAccepts,
    };

    return typeMap[type] ?? false;
}

module.exports = {
    getPreferences,
    updatePreferences,
    isTypeEnabled,
    DEFAULT_PREFERENCES,
};
