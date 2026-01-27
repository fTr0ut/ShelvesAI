const { query } = require('../pg');
const { rowToCamelCase, parsePagination } = require('./utils');

const UNREAD_COUNT_CACHE_TTL_MS = process.env.UNREAD_COUNT_CACHE_TTL_MS
    ? parseInt(process.env.UNREAD_COUNT_CACHE_TTL_MS, 10)
    : 5000;
const unreadCountCache = new Map();

// Lazy load push service to avoid circular dependencies
let pushNotificationService = null;
function getPushService() {
    if (!pushNotificationService) {
        pushNotificationService = require('../../services/pushNotificationService');
    }
    return pushNotificationService;
}

function normalizeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return {};
    return metadata;
}

function getCachedUnreadCount(userId) {
    if (UNREAD_COUNT_CACHE_TTL_MS <= 0) return null;
    const entry = unreadCountCache.get(userId);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        unreadCountCache.delete(userId);
        return null;
    }
    return entry.count;
}

function setCachedUnreadCount(userId, count) {
    if (UNREAD_COUNT_CACHE_TTL_MS <= 0) return;
    unreadCountCache.set(userId, {
        count,
        expiresAt: Date.now() + UNREAD_COUNT_CACHE_TTL_MS,
    });
}

function invalidateUnreadCount(userId) {
    unreadCountCache.delete(userId);
}

/**
 * Get actor name for push notification
 */
async function getActorName(actorId) {
    if (!actorId) return 'Someone';
    const result = await query(
        `SELECT username, first_name, last_name FROM users WHERE id = $1`,
        [actorId]
    );
    if (!result.rows[0]) return 'Someone';
    const row = result.rows[0];
    const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    return fullName || row.username || 'Someone';
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

    let notification = null;

    if (type === 'like') {
        const result = await query(
            `INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_id, actor_id, entity_id, type)
             WHERE deleted_at IS NULL AND type = 'like'
             DO NOTHING
             RETURNING *`,
            values
        );
        notification = result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    } else if (type === 'friend_request') {
        const result = await query(
            `INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_id, actor_id, entity_id, type)
             WHERE deleted_at IS NULL AND type = 'friend_request'
             DO NOTHING
             RETURNING *`,
            values
        );
        notification = result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    } else {
        const result = await query(
            `INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            values
        );
        notification = result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    }

    // Any change to notifications should invalidate the unread-count cache.
    invalidateUnreadCount(userId);

    // Fire-and-forget push notification
    if (notification) {
        (async () => {
            try {
                const actorName = await getActorName(actorId);
                const pushService = getPushService();
                await pushService.sendPushNotification({
                    id: notification.id,
                    userId,
                    type,
                    actorName,
                    metadata: normalizedMetadata,
                    entityId: String(entityId),
                    entityType,
                });
            } catch (err) {
                console.warn('Push notification failed:', err.message);
            }
        })();
    }

    return notification;
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

    if (result.rowCount > 0) {
        invalidateUnreadCount(userId);
    }

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

    if (result.rowCount > 0) {
        invalidateUnreadCount(userId);
    }

    return { updated: result.rowCount };
}

async function getUnreadCount(userId) {
    const cached = getCachedUnreadCount(userId);
    if (cached != null) {
        return cached;
    }

    const result = await query(
        `SELECT COUNT(*)::int AS unread_count
         FROM notifications
         WHERE user_id = $1
           AND is_read = FALSE
           AND deleted_at IS NULL`,
        [userId]
    );

    const count = result.rows[0]?.unread_count || 0;
    setCachedUnreadCount(userId, count);
    return count;
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
    if (result.rowCount > 0) {
        invalidateUnreadCount(userId);
    }
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
