const Expo = require('expo-server-sdk').default;
const pushDeviceTokens = require('../database/queries/pushDeviceTokens');
const notificationPreferences = require('../database/queries/notificationPreferences');
const broadcastLogs = require('../database/queries/broadcastLogs');
const logger = require('../logger');

const expo = new Expo();

/**
 * Build push notification content based on notification type
 */
function buildPushContent(type, actorName, metadata = {}) {
    const titleMap = {
        like: 'New Like',
        comment: 'New Comment',
        friend_request: 'Friend Request',
        friend_accept: 'Friend Accepted',
        mention: 'You were mentioned',
        workflow_complete: 'Scan Complete',
        workflow_failed: 'Scan Failed',
    };

    const bodyMap = {
        like: `${actorName} liked your activity`,
        comment: `${actorName} commented: "${truncate(metadata.preview || 'on your activity', 50)}"`,
        friend_request: `${actorName} sent you a friend request`,
        friend_accept: `${actorName} accepted your friend request`,
        mention: `${actorName} mentioned you in a comment: "${truncate(metadata.preview || '', 50)}"`,
        workflow_complete: truncate(metadata.summaryMessage || "Your queued workflow finished successfully.", 120),
        workflow_failed: truncate(metadata.summaryMessage || "Your queued workflow failed. Open the app to retry.", 120),
    };

    return {
        title: titleMap[type] || 'Notification',
        body: bodyMap[type] || `${actorName} interacted with you`,
    };
}

/**
 * Truncate text to a maximum length
 */
function truncate(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

/**
 * Send a push notification to a user
 *
 * @param {Object} options
 * @param {string} options.id - Notification ID
 * @param {string} options.userId - Target user ID
 * @param {string} options.type - Notification type (like, comment, friend_request, friend_accept)
 * @param {string} options.actorName - Name of the actor who triggered the notification
 * @param {Object} options.metadata - Additional metadata
 * @param {string} options.entityId - Entity ID for navigation
 * @param {string} options.entityType - Entity type for navigation (event, friendship)
 */
async function sendPushNotification({ id, userId, type, actorName, metadata = {}, entityId, entityType }) {
    try {
        // Check if this notification type is enabled for the user
        const isEnabled = await notificationPreferences.isTypeEnabled(userId, type);
        if (!isEnabled) {
            return { sent: false, reason: 'notification_type_disabled' };
        }

        // Get user's push tokens
        const tokens = await pushDeviceTokens.getTokensForUser(userId);
        if (!tokens || tokens.length === 0) {
            return { sent: false, reason: 'no_push_tokens' };
        }

        // Build notification content
        const { title, body } = buildPushContent(type, actorName, metadata);

        // Build messages for each token
        const messages = [];
        const invalidTokens = [];

        for (const tokenRecord of tokens) {
            const pushToken = tokenRecord.expoPushToken;

            // Validate token format
            if (!Expo.isExpoPushToken(pushToken)) {
                logger.warn(`Invalid Expo push token: ${pushToken}`);
                invalidTokens.push(pushToken);
                continue;
            }

            messages.push({
                to: pushToken,
                sound: 'default',
                title,
                body,
                data: {
                    type,
                    entityId: String(entityId),
                    entityType,
                    notificationId: id,
                    metadata,
                },
                badge: 1,
            });
        }

        // Deactivate invalid tokens
        for (const token of invalidTokens) {
            await pushDeviceTokens.deactivateToken(token);
        }

        if (messages.length === 0) {
            return { sent: false, reason: 'no_valid_tokens' };
        }

        // Chunk messages (Expo recommends batches of ~100)
        const chunks = expo.chunkPushNotifications(messages);
        const tickets = [];

        for (const chunk of chunks) {
            try {
                const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
                tickets.push(...ticketChunk);
            } catch (error) {
                logger.error('Error sending push notification chunk:', error);
            }
        }

        // Process tickets to find and handle errors
        const errors = await processTickets(tickets, messages);

        return {
            sent: true,
            ticketCount: tickets.length,
            errorCount: errors.length,
        };
    } catch (error) {
        logger.error('sendPushNotification error:', error);
        return { sent: false, reason: 'error', error: error.message };
    }
}

/**
 * Process push notification tickets and handle errors
 */
async function processTickets(tickets, messages) {
    const errors = [];

    for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const message = messages[i];

        if (ticket.status === 'error') {
            errors.push({ token: message?.to, error: ticket.message, details: ticket.details });

            // Handle DeviceNotRegistered by deactivating the token
            if (ticket.details?.error === 'DeviceNotRegistered' && message?.to) {
                logger.info(`Deactivating unregistered token: ${message.to}`);
                await pushDeviceTokens.deactivateToken(message.to);
            }
        }
    }

    return errors;
}

/**
 * Send a push notification to all active devices (broadcast).
 * Bypasses per-user notification preferences.
 * Checks for cancellation between each chunk so an in-progress send can be stopped.
 *
 * @param {Object} options
 * @param {number} options.broadcastId - ID of the broadcast_logs row
 * @param {string} options.title - Notification title
 * @param {string} options.body - Notification body
 * @param {Object} [options.metadata] - Additional metadata
 */
async function sendBroadcastNotification({ broadcastId, title, body, metadata = {} }) {
    try {
        await broadcastLogs.updateBroadcastLog(broadcastId, { status: 'running' });

        const tokenRows = await pushDeviceTokens.getAllActiveTokens();
        if (!tokenRows || tokenRows.length === 0) {
            await broadcastLogs.updateBroadcastLog(broadcastId, {
                status: 'completed',
                totalTokens: 0,
                successCount: 0,
                errorCount: 0,
            });
            return { sent: true, totalTokens: 0, successCount: 0, errorCount: 0 };
        }

        const messages = [];
        const invalidTokens = [];

        for (const row of tokenRows) {
            const pushToken = row.expoPushToken;
            if (!Expo.isExpoPushToken(pushToken)) {
                invalidTokens.push(pushToken);
                continue;
            }
            messages.push({
                to: pushToken,
                sound: 'default',
                title,
                body,
                data: {
                    type: 'system_broadcast',
                    broadcastId: String(broadcastId),
                    metadata,
                },
            });
        }

        for (const token of invalidTokens) {
            await pushDeviceTokens.deactivateToken(token);
        }

        const chunks = expo.chunkPushNotifications(messages);
        let successCount = 0;
        let errorCount = 0;

        for (const chunk of chunks) {
            // Check for cancellation between each batch
            const current = await broadcastLogs.getBroadcastStatus(broadcastId);
            if (current && current.status === 'cancelled') {
                logger.info(`Broadcast ${broadcastId} cancelled mid-send`);
                await broadcastLogs.updateBroadcastLog(broadcastId, {
                    totalTokens: messages.length,
                    successCount,
                    errorCount,
                });
                return { sent: false, reason: 'cancelled', successCount, errorCount };
            }

            try {
                const tickets = await expo.sendPushNotificationsAsync(chunk);
                const errors = await processTickets(tickets, chunk);
                successCount += tickets.length - errors.length;
                errorCount += errors.length;
            } catch (err) {
                logger.error('Error sending broadcast chunk:', err);
                errorCount += chunk.length;
            }
        }

        await broadcastLogs.updateBroadcastLog(broadcastId, {
            status: 'completed',
            totalTokens: messages.length,
            successCount,
            errorCount,
        });

        return { sent: true, totalTokens: messages.length, successCount, errorCount };
    } catch (err) {
        logger.error('sendBroadcastNotification error:', err);
        await broadcastLogs.updateBroadcastLog(broadcastId, { status: 'completed', errorCount: 0 });
        return { sent: false, reason: 'error', error: err.message };
    }
}

/**
 * Validate an Expo push token format
 */
function isValidExpoPushToken(token) {
    return Expo.isExpoPushToken(token);
}

module.exports = {
    sendPushNotification,
    sendBroadcastNotification,
    isValidExpoPushToken,
    buildPushContent,
};
