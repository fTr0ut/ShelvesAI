const notificationsQueries = require('../database/queries/notifications');
const { parsePagination } = require('../database/queries/utils');

async function list(req, res) {
    try {
        const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
        const result = await notificationsQueries.getForUser(req.user.id, { limit, offset });

        res.json({
            notifications: result.notifications,
            paging: { limit: result.limit, offset: result.offset },
        });
    } catch (err) {
        console.error('listNotifications error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

async function markRead(req, res) {
    try {
        const ids = req.body?.notificationIds;
        if (!Array.isArray(ids)) {
            return res.status(400).json({ error: 'notificationIds must be an array' });
        }

        const result = await notificationsQueries.markAsRead(req.user.id, ids);
        res.json({ updated: result.updated, ids: result.ids || [] });
    } catch (err) {
        console.error('markRead error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

async function getUnreadCount(req, res) {
    try {
        const unreadCount = await notificationsQueries.getUnreadCount(req.user.id);
        res.json({ unreadCount });
    } catch (err) {
        console.error('getUnreadCount error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

module.exports = {
    list,
    markRead,
    getUnreadCount,
};
