const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

/**
 * Get all friendships for a user
 */
async function getForUser(userId) {
    const result = await query(
        `SELECT f.*,
            u_req.username as requester_username,
            u_req.picture as requester_picture,
            u_addr.username as addressee_username,
            u_addr.picture as addressee_picture
     FROM friendships f
     JOIN users u_req ON u_req.id = f.requester_id
     JOIN users u_addr ON u_addr.id = f.addressee_id
     WHERE f.requester_id = $1 OR f.addressee_id = $1
     ORDER BY f.updated_at DESC`,
        [userId]
    );
    return result.rows.map(rowToCamelCase);
}

/**
 * Get accepted friend IDs for visibility checks
 */
async function getAcceptedFriendIds(userId) {
    const result = await query(
        `SELECT 
       CASE 
         WHEN requester_id = $1 THEN addressee_id
         ELSE requester_id
       END as friend_id
     FROM friendships
     WHERE status = 'accepted'
     AND (requester_id = $1 OR addressee_id = $1)`,
        [userId]
    );
    return result.rows.map(r => r.friend_id);
}

/**
 * Send a friend request
 */
async function sendRequest(requesterId, addresseeId, message = null) {
    if (requesterId === addresseeId) {
        return { error: 'Cannot friend yourself' };
    }

    // Check if friendship already exists
    const existing = await query(
        `SELECT * FROM friendships 
     WHERE (requester_id = $1 AND addressee_id = $2)
     OR (requester_id = $2 AND addressee_id = $1)`,
        [requesterId, addresseeId]
    );

    if (existing.rows.length > 0) {
        const friendship = existing.rows[0];
        if (friendship.status === 'blocked') {
            return { error: 'Cannot send request' };
        }
        return { error: 'Friendship already exists', friendship: rowToCamelCase(friendship) };
    }

    const result = await query(
        `INSERT INTO friendships (requester_id, addressee_id, message, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING *`,
        [requesterId, addresseeId, message]
    );
    return { friendship: rowToCamelCase(result.rows[0]) };
}

/**
 * Respond to a friend request (accept, reject, block)
 */
async function respond(friendshipId, userId, action) {
    if (!['accept', 'reject', 'block'].includes(action)) {
        return { error: 'Invalid action' };
    }

    // User must be the addressee
    const existing = await query(
        `SELECT * FROM friendships WHERE id = $1 AND addressee_id = $2`,
        [friendshipId, userId]
    );

    if (existing.rows.length === 0) {
        return { error: 'Friendship not found' };
    }

    if (action === 'reject') {
        await query('DELETE FROM friendships WHERE id = $1', [friendshipId]);
        return { deleted: true };
    }

    const status = action === 'accept' ? 'accepted' : 'blocked';
    const result = await query(
        `UPDATE friendships SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [status, friendshipId]
    );
    return { friendship: rowToCamelCase(result.rows[0]) };
}

/**
 * Check if two users are friends
 */
async function areFriends(userId1, userId2) {
    const result = await query(
        `SELECT 1 FROM friendships
     WHERE status = 'accepted'
     AND ((requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1))`,
        [userId1, userId2]
    );
    return result.rows.length > 0;
}

/**
 * Remove a friendship
 */
async function remove(friendshipId, userId) {
    const result = await query(
        `DELETE FROM friendships 
     WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)
     RETURNING id`,
        [friendshipId, userId]
    );
    return result.rowCount > 0;
}

module.exports = {
    getForUser,
    getAcceptedFriendIds,
    sendRequest,
    respond,
    areFriends,
    remove,
};
