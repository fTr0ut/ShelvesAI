const { query } = require('../pg');
const { rowToCamelCase, parsePagination } = require('./utils');

/**
 * Get public feed (all public shelves and activity)
 */
async function getPublicFeed({ limit = 20, offset = 0, type = null }) {
    let sql = `
    SELECT e.*, 
           u.username, u.picture as user_picture,
           s.name as shelf_name, s.type as shelf_type
    FROM event_logs e
    LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN shelves s ON s.id = e.shelf_id
    WHERE (s.visibility = 'public' OR s.id IS NULL)
  `;
    const params = [];

    if (type) {
        params.push(type);
        sql += ` AND e.event_type = $${params.length}`;
    }

    sql += ` ORDER BY e.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows.map(rowToCamelCase);
}

/**
 * Get friends feed (activity from friends and own)
 */
async function getFriendsFeed(userId, { limit = 20, offset = 0, type = null }) {
    let sql = `
    WITH friend_ids AS (
      SELECT 
        CASE 
          WHEN requester_id = $1 THEN addressee_id
          ELSE requester_id
        END as friend_id
      FROM friendships
      WHERE status = 'accepted'
      AND (requester_id = $1 OR addressee_id = $1)
    )
    SELECT e.*, 
           u.username, u.picture as user_picture,
           s.name as shelf_name, s.type as shelf_type
    FROM event_logs e
    LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN shelves s ON s.id = e.shelf_id
    WHERE (
      e.user_id = $1
      OR e.user_id IN (SELECT friend_id FROM friend_ids)
    )
    AND (
      s.visibility IN ('public', 'friends')
      OR s.owner_id = $1
      OR s.id IS NULL
    )
  `;
    const params = [userId];

    if (type) {
        params.push(type);
        sql += ` AND e.event_type = $${params.length}`;
    }

    sql += ` ORDER BY e.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows.map(rowToCamelCase);
}

/**
 * Get user's own activity
 */
async function getMyFeed(userId, { limit = 20, offset = 0, type = null }) {
    let sql = `
    SELECT e.*, 
           u.username, u.picture as user_picture,
           s.name as shelf_name, s.type as shelf_type
    FROM event_logs e
    LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN shelves s ON s.id = e.shelf_id
    WHERE e.user_id = $1
  `;
    const params = [userId];

    if (type) {
        params.push(type);
        sql += ` AND e.event_type = $${params.length}`;
    }

    sql += ` ORDER BY e.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows.map(rowToCamelCase);
}

/**
 * Log an event
 */
async function logEvent({ userId, shelfId, eventType, payload = {} }) {
    const result = await query(
        `INSERT INTO event_logs (user_id, shelf_id, event_type, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
        [userId, shelfId, eventType, JSON.stringify(payload)]
    );
    return rowToCamelCase(result.rows[0]);
}

module.exports = {
    getPublicFeed,
    getFriendsFeed,
    getMyFeed,
    logEvent,
};
