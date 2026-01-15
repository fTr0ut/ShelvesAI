const { query } = require('../pg');
const { rowToCamelCase, parsePagination } = require('./utils');

function normalizeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return {};
    return metadata;
}

async function create({ userId, actorId, type, entityId, entityType, metadata = {} }) {
    const normalizedMetadata = normalizeMetadata(metadata);
    const values = [
        userId,
        actorId || null,
        type,
        String(entityId),
        entityType,
        normalizedMetadata,
    ];

    if (type === 'like' || type === 'friend_request') {
        const result = await query(
            `INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_id, actor_id, entity_id, type) DO NOTHING
             RETURNING *`,
            values
        );
        return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    }

    const result = await query(
        `INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        values
    );

    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function getForUser(userId, options = {}) {
    const { limit, offset } = parsePagination(options, { defaultLimit: 20, maxLimit: 100 });

    const result = await query(
        `SELECT n.*,
                u.username as actor_username,
                u.first_name as actor_first_name,
                u.last_name as actor_last_name,
                u.picture as actor_picture,
                pm.local_path as actor_profile_media_path
         FROM notifications n
         LEFT JOIN users u ON u.id = n.actor_id
         LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
         WHERE n.user_id = $1
           AND n.deleted_at IS NULL
         ORDER BY n.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
    );

    const notifications = result.rows.map((row) => {
        const item = rowToCamelCase(row);
        const fullName = [row.actor_first_name, row.actor_last_name].filter(Boolean).join(' ').trim();

        return {
            id: item.id,
            type: item.type,
            entityId: item.entityId,
            entityType: item.entityType,
            metadata: item.metadata || {},
            isRead: !!item.isRead,
            createdAt: item.createdAt,
            actor: row.actor_id ? {
                id: row.actor_id,
                username: row.actor_username,
                name: fullName || undefined,
                picture: row.actor_picture,
                profileMediaPath: row.actor_profile_media_path,
            } : null,
        };
    });

    return { notifications, limit, offset };
}

async function markAsRead(userId, notificationIds) {
    const ids = Array.isArray(notificationIds)
        ? notificationIds.filter(Boolean).map((id) => String(id))
        : [];

    if (!ids.length) {
        return { updated: 0 };
    }

    const result = await query(
        `UPDATE notifications
         SET is_read = TRUE
         WHERE user_id = $1
           AND id = ANY($2::uuid[])
           AND deleted_at IS NULL
         RETURNING id`,
        [userId, ids]
    );

    return { updated: result.rowCount, ids: result.rows.map((row) => row.id) };
}

async function markAllAsRead(userId) {
    const result = await query(
        `UPDATE notifications
         SET is_read = TRUE
         WHERE user_id = $1
           AND is_read = FALSE
           AND deleted_at IS NULL
         RETURNING id`,
        [userId]
    );

    return { updated: result.rowCount };
}

async function getUnreadCount(userId) {
    const result = await query(
        `SELECT COUNT(*)::int AS unread_count
         FROM notifications
         WHERE user_id = $1
           AND is_read = FALSE
           AND deleted_at IS NULL`,
        [userId]
    );
    return result.rows[0]?.unread_count || 0;
}

async function softDeleteLike({ userId, actorId, entityId }) {
    const result = await query(
        `UPDATE notifications
         SET deleted_at = NOW()
         WHERE user_id = $1
           AND actor_id = $2
           AND entity_id = $3
           AND type = 'like'
           AND deleted_at IS NULL
         RETURNING id`,
        [userId, actorId || null, String(entityId)]
    );
    return result.rowCount > 0;
}

module.exports = {
    create,
    getForUser,
    markAsRead,
    markAllAsRead,
    getUnreadCount,
    softDeleteLike,
};
