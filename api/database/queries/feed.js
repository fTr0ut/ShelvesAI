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
 * Get global feed (friends' posts + public posts, EXCLUDING self)
 */
async function getGlobalFeed(userId, { limit = 20, offset = 0, type = null }) {
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
           pm.local_path as profile_media_path,
           u.first_name, u.last_name, u.city, u.state, u.country,
           s.name as shelf_name, s.type as shelf_type, s.description as shelf_description,
           c.title as collectable_title, c.primary_creator as collectable_creator,
           c.cover_url as collectable_cover_url, c.kind as collectable_kind,
           cm.local_path as collectable_cover_media_path
    FROM event_aggregates a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
    LEFT JOIN shelves s ON s.id = a.shelf_id
    LEFT JOIN collectables c ON c.id = a.collectable_id
    LEFT JOIN media cm ON cm.id = c.cover_media_id
    WHERE a.user_id != $1 -- Exclude self
    AND (
      -- Shelf-based events: check shelf visibility
      (a.shelf_id IS NOT NULL AND (
        s.visibility = 'public'
        OR (a.user_id IN (SELECT friend_id FROM friend_ids) AND s.visibility = 'friends')
      ))
      OR
      -- Check-in events: check event visibility
      (a.event_type = 'checkin.activity' AND (
        a.visibility = 'public'
        OR (a.user_id IN (SELECT friend_id FROM friend_ids) AND a.visibility = 'friends')
      ))
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
 * Get ALL feed (User + Friends + Public)
 */
async function getAllFeed(userId, { limit = 20, offset = 0, type = null }) {
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
           pm.local_path as profile_media_path,
           u.first_name, u.last_name, u.city, u.state, u.country,
           s.name as shelf_name, s.type as shelf_type, s.description as shelf_description,
           c.title as collectable_title, c.primary_creator as collectable_creator,
           c.cover_url as collectable_cover_url, c.kind as collectable_kind,
           cm.local_path as collectable_cover_media_path
    FROM event_aggregates a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
    LEFT JOIN shelves s ON s.id = a.shelf_id
    LEFT JOIN collectables c ON c.id = a.collectable_id
    LEFT JOIN media cm ON cm.id = c.cover_media_id
    WHERE (
      a.user_id = $1 -- Include self (all own events)
      OR
      -- Shelf-based events from others
      (a.shelf_id IS NOT NULL AND (
        s.visibility = 'public'
        OR (a.user_id IN (SELECT friend_id FROM friend_ids) AND s.visibility = 'friends')
      ))
      OR
      -- Check-in events from others
      (a.event_type = 'checkin.activity' AND a.user_id != $1 AND (
        a.visibility = 'public'
        OR (a.user_id IN (SELECT friend_id FROM friend_ids) AND a.visibility = 'friends')
      ))
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
 * Get friends feed (activity from friends ONLY)
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
           pm.local_path as profile_media_path,
           u.first_name, u.last_name, u.city, u.state, u.country,
           s.name as shelf_name, s.type as shelf_type, s.description as shelf_description,
           c.title as collectable_title, c.primary_creator as collectable_creator,
           c.cover_url as collectable_cover_url, c.kind as collectable_kind,
           cm.local_path as collectable_cover_media_path
    FROM event_aggregates a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
    LEFT JOIN shelves s ON s.id = a.shelf_id
    LEFT JOIN collectables c ON c.id = a.collectable_id
    LEFT JOIN media cm ON cm.id = c.cover_media_id
    WHERE a.user_id IN (SELECT friend_id FROM friend_ids) -- Friends only, no self
    AND (
      -- Shelf-based events
      (a.shelf_id IS NOT NULL AND s.visibility IN ('public', 'friends'))
      OR
      -- Check-in events
      (a.event_type = 'checkin.activity' AND a.visibility IN ('public', 'friends'))
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
           pm.local_path as profile_media_path,
           u.first_name, u.last_name, u.city, u.state, u.country,
           s.name as shelf_name, s.type as shelf_type, s.description as shelf_description,
           c.title as collectable_title, c.primary_creator as collectable_creator,
           c.cover_url as collectable_cover_url, c.kind as collectable_kind,
           cm.local_path as collectable_cover_media_path
    FROM event_aggregates a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
    LEFT JOIN shelves s ON s.id = a.shelf_id
    LEFT JOIN collectables c ON c.id = a.collectable_id
    LEFT JOIN media cm ON cm.id = c.cover_media_id
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
  if (shelfId !== null && shelfId !== undefined) {
    const visibilityResult = await query(
      'SELECT visibility FROM shelves WHERE id = $1',
      [shelfId]
    );
    const visibility = visibilityResult.rows[0]?.visibility || null;
    if (!visibility || visibility === 'private') {
      if (FEED_AGGREGATE_DEBUG) {
        console.log('[feed.event] skipped private shelf', {
          shelfId,
          eventType,
          userId,
        });
      }
      return null;
    }
  }

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

/**
 * Log a check-in event (user is starting/continuing/completed with a collectable)
 */
async function logCheckIn({ userId, collectableId, status, visibility = 'public', note = null }) {
  if (!userId || !collectableId || !status) {
    throw new Error('userId, collectableId, and status are required for check-in');
  }

  const validStatuses = ['starting', 'continuing', 'completed'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
  }

  const validVisibilities = ['public', 'friends'];
  if (!validVisibilities.includes(visibility)) {
    throw new Error(`Invalid visibility: ${visibility}. Must be one of: ${validVisibilities.join(', ')}`);
  }

  // Check-in events don't aggregate like shelf events - each is unique
  const result = await query(
    `INSERT INTO event_aggregates (
      user_id, event_type, collectable_id, checkin_status, visibility, note,
      window_start_utc, window_end_utc, item_count
    )
    VALUES ($1, 'checkin.activity', $2, $3, $4, $5, NOW(), NOW(), 1)
    RETURNING *`,
    [userId, collectableId, status, visibility, note]
  );

  if (FEED_AGGREGATE_DEBUG) {
    console.log('[feed.checkin] created', {
      aggregateId: result.rows[0]?.id,
      userId,
      collectableId,
      status,
      visibility,
    });
  }

  return rowToCamelCase(result.rows[0]);
}

module.exports = {
  getGlobalFeed,
  getAllFeed,
  getFriendsFeed,
  getMyFeed,
  logEvent,
  logCheckIn,
};
