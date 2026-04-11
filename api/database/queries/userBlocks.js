const { query, transaction } = require('../pg');
const { rowToCamelCase, parsePagination } = require('./utils');

async function isBlockedEitherDirection(userId1, userId2) {
    if (!userId1 || !userId2) return false;
    if (String(userId1) === String(userId2)) return false;

    const result = await query(
        'SELECT users_are_blocked($1::uuid, $2::uuid) AS blocked',
        [userId1, userId2]
    );
    return result.rows[0]?.blocked === true;
}

async function blockUser(blockerId, blockedId) {
    if (!blockerId || !blockedId) {
        return { error: 'Both blockerId and blockedId are required' };
    }
    if (String(blockerId) === String(blockedId)) {
        return { error: 'You cannot block yourself' };
    }

    return transaction(async (client) => {
        const targetResult = await client.query(
            `SELECT u.id,
                    u.username,
                    u.first_name,
                    u.last_name,
                    u.picture,
                    pm.local_path AS profile_media_path
             FROM users u
             LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
             WHERE u.id = $1
               AND u.is_suspended = false
             LIMIT 1`,
            [blockedId]
        );
        const target = targetResult.rows[0];
        if (!target) {
            return { error: 'Unable to complete request' };
        }

        const inserted = await client.query(
            `INSERT INTO user_blocks (blocker_id, blocked_id)
             VALUES ($1, $2)
             ON CONFLICT (blocker_id, blocked_id)
             DO UPDATE SET blocker_id = EXCLUDED.blocker_id
             RETURNING *`,
            [blockerId, blockedId]
        );

        await client.query(
            `DELETE FROM friendships
             WHERE (requester_id = $1 AND addressee_id = $2)
                OR (requester_id = $2 AND addressee_id = $1)`,
            [blockerId, blockedId]
        );

        await client.query(
            `UPDATE notifications
             SET deleted_at = NOW()
             WHERE deleted_at IS NULL
               AND type IN ('friend_request', 'friend_accept', 'like', 'comment', 'mention')
               AND (
                 (user_id = $1 AND actor_id = $2)
                 OR (user_id = $2 AND actor_id = $1)
               )`,
            [blockerId, blockedId]
        );

        return {
            block: rowToCamelCase(inserted.rows[0]),
            blockedUser: {
                id: target.id,
                username: target.username,
                name: [target.first_name, target.last_name].filter(Boolean).join(' ').trim() || undefined,
                picture: target.picture,
                profileMediaPath: target.profile_media_path,
            },
        };
    });
}

async function unblockUser(blockerId, blockedId) {
    const result = await query(
        `DELETE FROM user_blocks
         WHERE blocker_id = $1
           AND blocked_id = $2
         RETURNING *`,
        [blockerId, blockedId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function listBlockedUsers(userId, options = {}) {
    const { limit, offset } = parsePagination(options, { defaultLimit: 50, maxLimit: 200 });

    const result = await query(
        `SELECT ub.*,
                u.id AS blocked_user_id,
                u.username AS blocked_username,
                u.first_name AS blocked_first_name,
                u.last_name AS blocked_last_name,
                u.picture AS blocked_picture,
                pm.local_path AS blocked_profile_media_path
         FROM user_blocks ub
         JOIN users u ON u.id = ub.blocked_id
         LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
         WHERE ub.blocker_id = $1
         ORDER BY ub.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
    );

    const countResult = await query(
        `SELECT COUNT(*)::int AS total
         FROM user_blocks
         WHERE blocker_id = $1`,
        [userId]
    );

    return {
        blocks: result.rows.map((row) => ({
            id: row.id,
            blockerId: row.blocker_id,
            blockedId: row.blocked_id,
            createdAt: row.created_at,
            blockedUser: {
                id: row.blocked_user_id,
                username: row.blocked_username,
                name: [row.blocked_first_name, row.blocked_last_name].filter(Boolean).join(' ').trim() || undefined,
                picture: row.blocked_picture,
                profileMediaPath: row.blocked_profile_media_path,
            },
        })).map(rowToCamelCase),
        total: countResult.rows[0]?.total || 0,
        limit,
        offset,
    };
}

module.exports = {
    isBlockedEitherDirection,
    blockUser,
    unblockUser,
    listBlockedUsers,
};
