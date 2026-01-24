const Expo = require('expo-server-sdk').default;
const pushDeviceTokens = require('../database/queries/pushDeviceTokens');
const notificationPreferences = require('../database/queries/notificationPreferences');

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
    };

    const bodyMap = {
        like: `${actorName} liked your activity`,
        comment: `${actorName} commented: "${truncate(metadata.commentText || 'on your activity', 50)}"`,
        friend_request: `${actorName} sent you a friend request`,
        friend_accept: `${actorName} accepted your friend request`,
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
                console.warn(`Invalid Expo push token: ${pushToken}`);
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
                console.error('Error sending push notification chunk:', error);
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
        console.error('sendPushNotification error:', error);
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
                console.log(`Deactivating unregistered token: ${message.to}`);
                await pushDeviceTokens.deactivateToken(message.to);
            }
        }
    }

    return errors;
}

/**
 * Validate an Expo push token format
 */
function isValidExpoPushToken(token) {
    return Expo.isExpoPushToken(token);
}

module.exports = {
    sendPushNotification,
    isValidExpoPushToken,
    buildPushContent,
};
