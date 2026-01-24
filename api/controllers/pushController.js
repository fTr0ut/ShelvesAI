const pushDeviceTokens = require('../database/queries/pushDeviceTokens');
const notificationPreferences = require('../database/queries/notificationPreferences');
const { isValidExpoPushToken } = require('../services/pushNotificationService');

/**
 * Register a push token for the authenticated user
 * POST /api/push/register
 */
async function registerPushToken(req, res) {
    try {
        const { expoPushToken, deviceId, platform } = req.body;

        if (!expoPushToken) {
            return res.status(400).json({ error: 'expoPushToken is required' });
        }

        if (!isValidExpoPushToken(expoPushToken)) {
            return res.status(400).json({ error: 'Invalid Expo push token format' });
        }

        const token = await pushDeviceTokens.registerToken(req.user.id, expoPushToken, {
            deviceId,
            platform,
        });

        res.json({ success: true, token });
    } catch (err) {
        console.error('registerPushToken error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * Unregister a push token (on logout)
 * POST /api/push/unregister
 */
async function unregisterPushToken(req, res) {
    try {
        const { expoPushToken } = req.body;

        if (!expoPushToken) {
            return res.status(400).json({ error: 'expoPushToken is required' });
        }

        const removed = await pushDeviceTokens.removeToken(req.user.id, expoPushToken);

        res.json({ success: true, removed });
    } catch (err) {
        console.error('unregisterPushToken error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * Get notification preferences for the authenticated user
 * GET /api/push/preferences
 */
async function getNotificationPreferences(req, res) {
    try {
        const preferences = await notificationPreferences.getPreferences(req.user.id);

        res.json({
            preferences: {
                pushEnabled: preferences.pushEnabled,
                pushLikes: preferences.pushLikes,
                pushComments: preferences.pushComments,
                pushFriendRequests: preferences.pushFriendRequests,
                pushFriendAccepts: preferences.pushFriendAccepts,
            },
        });
    } catch (err) {
        console.error('getNotificationPreferences error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * Update notification preferences for the authenticated user
 * PATCH /api/push/preferences
 */
async function updateNotificationPreferences(req, res) {
    try {
        const updates = req.body;

        // Validate that only boolean values are provided for allowed fields
        const allowedFields = ['pushEnabled', 'pushLikes', 'pushComments', 'pushFriendRequests', 'pushFriendAccepts'];
        const filteredUpdates = {};

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                if (typeof updates[field] !== 'boolean') {
                    return res.status(400).json({ error: `${field} must be a boolean` });
                }
                filteredUpdates[field] = updates[field];
            }
        }

        if (Object.keys(filteredUpdates).length === 0) {
            return res.status(400).json({ error: 'No valid preference fields provided' });
        }

        const preferences = await notificationPreferences.updatePreferences(req.user.id, filteredUpdates);

        res.json({
            preferences: {
                pushEnabled: preferences.pushEnabled,
                pushLikes: preferences.pushLikes,
                pushComments: preferences.pushComments,
                pushFriendRequests: preferences.pushFriendRequests,
                pushFriendAccepts: preferences.pushFriendAccepts,
            },
        });
    } catch (err) {
        console.error('updateNotificationPreferences error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

module.exports = {
    registerPushToken,
    unregisterPushToken,
    getNotificationPreferences,
    updateNotificationPreferences,
};
