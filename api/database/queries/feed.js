const { query, transaction } = require('../pg');
const { rowToCamelCase, parsePagination } = require('./utils');

const AGGREGATE_WINDOW_MINUTES = parseInt(process.env.FEED_AGGREGATE_WINDOW_MINUTES || '15', 10);
const PREVIEW_PAYLOAD_LIMIT = parseInt(process.env.FEED_AGGREGATE_PREVIEW_LIMIT || '5', 10);
const FEED_AGGREGATE_DEBUG = String(process.env.FEED_AGGREGATE_DEBUG || '').toLowerCase() === 'true';

function normalizePayload(payload) {
  if (payload && typeof payload === 'object') return payload;
  return {};
}

async function getOrCreateAggregate(client, { userId, shelfId, eventType }) {
  const findResult = await client.query(
    `SELECT *
     FROM event_aggregates
     WHERE user_id = $1
       AND shelf_id = $2
       AND event_type = $3
       AND window_end_utc >= NOW()
     ORDER BY window_end_utc DESC
     LIMIT 1
     FOR UPDATE`,
    [userId, shelfId, eventType]
  );

  if (findResult.rows.length) return findResult.rows[0];

  const insertResult = await client.query(
    `INSERT INTO event_aggregates (user_id, shelf_id, event_type, window_start_utc, window_end_utc)
     VALUES ($1, $2, $3, NOW(), NOW() + make_interval(mins => $4))
     RETURNING *`,
    [userId, shelfId, eventType, AGGREGATE_WINDOW_MINUTES]
  );

  if (FEED_AGGREGATE_DEBUG) {
    console.log('[feed.aggregate] created', {
      aggregateId: insertResult.rows[0]?.id,
      userId,
      shelfId,
      eventType,
      windowMinutes: AGGREGATE_WINDOW_MINUTES,
    });
  }

  return insertResult.rows[0];
}

/**
 * Get public feed (all public shelves and activity)
 */
async function getPublicFeed({ limit = 20, offset = 0, type = null }) {
  let sql = `
    SELECT a.*, 
           u.username, u.picture as user_picture,
           u.first_name, u.last_name, u.city, u.state, u.country,
           s.name as shelf_name, s.type as shelf_type, s.description as shelf_description
    FROM event_aggregates a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN shelves s ON s.id = a.shelf_id
    WHERE (s.visibility = 'public' OR s.id IS NULL)
  `;
  const params = [];

  if (type) {
    params.push(type);
    sql += ` AND a.event_type = $${params.length}`;
  }

  sql += ` ORDER BY a.last_activity_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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
    SELECT a.*, 
           u.username, u.picture as user_picture,
           u.first_name, u.last_name, u.city, u.state, u.country,
           s.name as shelf_name, s.type as shelf_type, s.description as shelf_description
    FROM event_aggregates a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN shelves s ON s.id = a.shelf_id
    WHERE (
      a.user_id = $1
      OR a.user_id IN (SELECT friend_id FROM friend_ids)
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
    sql += ` AND a.event_type = $${params.length}`;
  }

  sql += ` ORDER BY a.last_activity_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await query(sql, params);
  return result.rows.map(rowToCamelCase);
}

/**
 * Get user's own activity
 */
async function getMyFeed(userId, { limit = 20, offset = 0, type = null }) {
  let sql = `
    SELECT a.*, 
           u.username, u.picture as user_picture,
           u.first_name, u.last_name, u.city, u.state, u.country,
           s.name as shelf_name, s.type as shelf_type, s.description as shelf_description
    FROM event_aggregates a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN shelves s ON s.id = a.shelf_id
    WHERE a.user_id = $1
  `;
  const params = [userId];

  if (type) {
    params.push(type);
    sql += ` AND a.event_type = $${params.length}`;
  }

  sql += ` ORDER BY a.last_activity_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await query(sql, params);
  return result.rows.map(rowToCamelCase);
}

/**
 * Log an event
 */
async function logEvent({ userId, shelfId, eventType, payload = {} }) {
  if (!userId || !shelfId || !eventType) {
    const result = await query(
      `INSERT INTO event_logs (user_id, shelf_id, event_type, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId || null, shelfId || null, eventType || null, JSON.stringify(normalizePayload(payload))]
    );
    return rowToCamelCase(result.rows[0]);
  }

  return transaction(async (client) => {
    const aggregate = await getOrCreateAggregate(client, { userId, shelfId, eventType });
    const payloadValue = normalizePayload(payload);
    const payloadCount = Number(payloadValue.itemCount);
    const itemIncrement = Number.isFinite(payloadCount) && payloadCount > 0 ? Math.trunc(payloadCount) : 1;

    const insertResult = await client.query(
      `INSERT INTO event_logs (user_id, shelf_id, aggregate_id, event_type, payload)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, shelfId, aggregate.id, eventType, JSON.stringify(payloadValue)]
    );

    await client.query(
      `UPDATE event_aggregates
       SET item_count = item_count + $1,
           last_activity_at = NOW(),
           preview_payloads = CASE
             WHEN jsonb_array_length(preview_payloads) < $2
             THEN preview_payloads || jsonb_build_array($3::jsonb)
             ELSE preview_payloads
           END
       WHERE id = $4`,
      [itemIncrement, PREVIEW_PAYLOAD_LIMIT, JSON.stringify(payloadValue), aggregate.id]
    );

    if (FEED_AGGREGATE_DEBUG) {
      console.log('[feed.event] logged', {
        eventId: insertResult.rows[0]?.id,
        aggregateId: aggregate?.id,
        userId,
        shelfId,
        eventType,
      });
    }

    return rowToCamelCase(insertResult.rows[0]);
  });
}

module.exports = {
  getPublicFeed,
  getFriendsFeed,
  getMyFeed,
  logEvent,
};
