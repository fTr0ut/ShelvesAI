const { query, transaction } = require('../pg');
const { rowToCamelCase, parsePagination } = require('./utils');
const { AGGREGATE_WINDOW_MINUTES, PREVIEW_PAYLOAD_LIMIT } = require('../../config/constants');
const logger = require('../../logger');

const FEED_AGGREGATE_DEBUG = String(process.env.FEED_AGGREGATE_DEBUG || '').toLowerCase() === 'true';
const FEED_MICRO_DEBUG = String(process.env.FEED_MICRO_DEBUG_ENABLED || '').toLowerCase() === 'true';

function logFeedMicro(stage, payload = {}) {
  if (!FEED_MICRO_DEBUG) return;
  logger.info(`[feed.micro] ${stage}`, payload);
}

function normalizePayload(payload) {
  if (payload && typeof payload === 'object') return payload;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_err) {
      return {};
    }
  }
  return {};
}

function getAggregateScopeKey({ shelfId, eventType, isItemEvent }) {
  if (shelfId == null) {
    return `global:${eventType || 'unknown'}`;
  }
  if (isItemEvent) {
    return `shelf:${shelfId}:item`;
  }
  return `shelf:${shelfId}:${eventType || 'unknown'}`;
}

function getRatedItemIdentity(payload = {}) {
  const normalized = normalizePayload(payload);
  const collectableId = normalized.collectableId ?? normalized.collectable_id ?? normalized.collectable?.id ?? null;
  const manualId = normalized.manualId ?? normalized.manual_id ?? normalized.manual?.id ?? null;
  const itemId = normalized.itemId ?? normalized.id ?? null;
  return {
    collectableId: collectableId == null ? null : String(collectableId),
    manualId: manualId == null ? null : String(manualId),
    itemId: itemId == null ? null : String(itemId),
  };
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function sortJsonForCompare(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonForCompare);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sorted = {};
  Object.keys(value).sort().forEach((key) => {
    sorted[key] = sortJsonForCompare(value[key]);
  });
  return sorted;
}

function normalizeReviewedRating(value) {
  if (value === null || value === undefined || value === '') return null;
  const rating = Number(value);
  return Number.isFinite(rating) ? rating : null;
}

function getReviewedContentSignature(payload = {}) {
  const normalized = normalizePayload(payload);
  return JSON.stringify({
    notes: normalized.notes ?? null,
    rating: normalizeReviewedRating(normalized.rating),
    metadata: sortJsonForCompare(normalized.metadata ?? null),
  });
}

function getReviewedIdentity(payload = {}) {
  const normalized = normalizePayload(payload);
  const itemId = normalized.itemId ?? normalized.id ?? null;
  const sourceShelfId = normalized.sourceShelfId ?? normalized.source_shelf_id ?? null;
  const collectableId = normalized.collectableId ?? normalized.collectable_id ?? normalized.collectable?.id ?? null;
  const manualId = normalized.manualId ?? normalized.manual_id ?? normalized.manual?.id ?? null;
  return {
    itemId: itemId == null ? null : String(itemId),
    sourceShelfId: sourceShelfId == null ? null : String(sourceShelfId),
    collectableId: collectableId == null ? null : String(collectableId),
    manualId: manualId == null ? null : String(manualId),
  };
}

async function getReviewedEventLogById(client, { userId, reviewedEventLogId }) {
  if (!reviewedEventLogId || !userId) return null;
  const eventLogId = Number(reviewedEventLogId);
  if (!Number.isFinite(eventLogId) || eventLogId <= 0) return null;
  const result = await client.query(
    `SELECT id, aggregate_id, payload, created_at
     FROM event_logs
     WHERE id = $1
       AND user_id = $2
       AND event_type = 'reviewed'
     LIMIT 1
     FOR UPDATE`,
    [eventLogId, userId],
  );
  return result.rows[0] || null;
}

async function findLatestReviewedEventLogByIdentity(client, { userId, payload }) {
  if (!userId) return null;
  const identity = getReviewedIdentity(payload);
  if (identity.itemId) {
    const result = await client.query(
      `SELECT id, aggregate_id, payload, created_at
       FROM event_logs
       WHERE user_id = $1
         AND event_type = 'reviewed'
         AND ($2::text IS NULL OR payload->>'sourceShelfId' = $2::text)
         AND (
           payload->>'itemId' = $3::text
           OR payload->>'id' = $3::text
         )
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [userId, identity.sourceShelfId, identity.itemId],
    );
    return result.rows[0] || null;
  }

  if (!identity.collectableId && !identity.manualId) return null;
  const result = await client.query(
    `SELECT id, aggregate_id, payload, created_at
     FROM event_logs
     WHERE user_id = $1
       AND event_type = 'reviewed'
       AND ($2::text IS NULL OR payload->>'sourceShelfId' = $2::text)
       AND (
         ($3::text IS NOT NULL AND (payload->>'collectableId' = $3::text OR payload->>'collectable_id' = $3::text))
         OR ($4::text IS NOT NULL AND (payload->>'manualId' = $4::text OR payload->>'manual_id' = $4::text))
       )
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [userId, identity.sourceShelfId, identity.collectableId, identity.manualId],
  );
  return result.rows[0] || null;
}

async function refreshRatedAggregateSummary(client, aggregateId) {
  await client.query(
    `WITH counts AS (
       SELECT COUNT(*)::int AS item_count
       FROM event_logs
       WHERE aggregate_id = $1
         AND event_type = 'item.rated'
     ),
     preview AS (
       SELECT COALESCE(jsonb_agg(p.payload ORDER BY p.created_at DESC), '[]'::jsonb) AS preview_payloads
       FROM (
         SELECT payload, created_at
         FROM event_logs
         WHERE aggregate_id = $1
           AND event_type = 'item.rated'
         ORDER BY created_at DESC
         LIMIT $2
       ) p
     )
     UPDATE event_aggregates a
     SET item_count = counts.item_count,
         last_activity_at = NOW(),
         preview_payloads = preview.preview_payloads
     FROM counts, preview
     WHERE a.id = $1`,
    [aggregateId, PREVIEW_PAYLOAD_LIMIT],
  );
}

async function getOrCreateAggregate(client, { userId, shelfId, eventType }) {
  // For item.* events on shelves, aggregate together regardless of specific type
  // For rating events (shelfId = null), aggregate globally
  // For reviewed events, always create a fresh aggregate (no aggregation window reuse)
  // For other events (checkin, etc.), keep separate
  const isItemEvent = eventType && eventType.startsWith('item.');
  const shouldAggregateByWindow = eventType !== 'reviewed';
  const aggregateScopeKey = getAggregateScopeKey({ shelfId, eventType, isItemEvent });

  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [String(userId), aggregateScopeKey],
  );

  if (shouldAggregateByWindow) {
    let findQuery;
    let findParams;

    if (shelfId == null) {
      // Global aggregation (ratings) - match by eventType with null shelfId
      findQuery = `SELECT *
       FROM event_aggregates
       WHERE user_id = $1
         AND shelf_id IS NULL
         AND event_type = $2
         AND window_end_utc >= NOW()
       ORDER BY window_end_utc DESC
       LIMIT 1
       FOR UPDATE`;
      findParams = [userId, eventType];
    } else if (isItemEvent) {
      // Shelf-based item events - aggregate ALL item.* types together
      findQuery = `SELECT *
       FROM event_aggregates
       WHERE user_id = $1
         AND shelf_id = $2
         AND event_type LIKE 'item.%'
         AND window_end_utc >= NOW()
       ORDER BY window_end_utc DESC
       LIMIT 1
       FOR UPDATE`;
      findParams = [userId, shelfId];
    } else {
      // Other events (checkin, etc.) - keep by specific type
      findQuery = `SELECT *
       FROM event_aggregates
       WHERE user_id = $1
         AND shelf_id = $2
         AND event_type = $3
         AND window_end_utc >= NOW()
       ORDER BY window_end_utc DESC
       LIMIT 1
       FOR UPDATE`;
      findParams = [userId, shelfId, eventType];
    }

    const findResult = await client.query(findQuery, findParams);
    if (findResult.rows.length) return findResult.rows[0];
  }

  // Use generic type for aggregated item events
  const aggregateEventType = isItemEvent && shelfId != null ? 'item.added' : eventType;

  const insertResult = await client.query(
    `INSERT INTO event_aggregates (user_id, shelf_id, event_type, window_start_utc, window_end_utc)
     VALUES ($1, $2, $3, NOW(), NOW() + make_interval(mins => $4))
     RETURNING *`,
    [userId, shelfId, aggregateEventType, AGGREGATE_WINDOW_MINUTES]
  );

  if (FEED_AGGREGATE_DEBUG) {
    logger.info('[feed.aggregate] created', {
      aggregateId: insertResult.rows[0]?.id,
      userId,
      shelfId,
      eventType: aggregateEventType,
      originalEventType: eventType,
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
           c.cover_url as collectable_cover_url,
           c.cover_image_url as collectable_cover_image_url,
           c.cover_image_source as collectable_cover_image_source,
           c.kind as collectable_kind,
           cm.local_path as collectable_cover_media_path,
           um.name as manual_name, um.author as manual_author, um.type as manual_type,
           um.cover_media_path as manual_cover_media_path
    FROM event_aggregates a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
    LEFT JOIN shelves s ON s.id = a.shelf_id
    LEFT JOIN collectables c ON c.id = a.collectable_id
    LEFT JOIN media cm ON cm.id = c.cover_media_id
    LEFT JOIN user_manuals um ON um.id = a.manual_id
    WHERE a.user_id != $1 -- Exclude self
    AND u.is_suspended = false -- Filter out suspended users
    AND (
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
      OR
      -- Global events (ratings/reviews): visible to friends
      (a.shelf_id IS NULL AND a.event_type IN ('item.rated', 'reviewed') AND a.user_id IN (SELECT friend_id FROM friend_ids))
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
           c.cover_url as collectable_cover_url,
           c.cover_image_url as collectable_cover_image_url,
           c.cover_image_source as collectable_cover_image_source,
           c.kind as collectable_kind,
           cm.local_path as collectable_cover_media_path,
           um.name as manual_name, um.author as manual_author, um.type as manual_type,
           um.cover_media_path as manual_cover_media_path
    FROM event_aggregates a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
    LEFT JOIN shelves s ON s.id = a.shelf_id
    LEFT JOIN collectables c ON c.id = a.collectable_id
    LEFT JOIN media cm ON cm.id = c.cover_media_id
    LEFT JOIN user_manuals um ON um.id = a.manual_id
    WHERE (u.is_suspended = false OR a.user_id = $1) -- Filter suspended users except self
    AND (
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
      OR
      -- Global rating/review events from friends
      (a.shelf_id IS NULL AND a.event_type IN ('item.rated', 'reviewed') AND a.user_id != $1 AND a.user_id IN (SELECT friend_id FROM friend_ids))
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
           c.cover_url as collectable_cover_url,
           c.cover_image_url as collectable_cover_image_url,
           c.cover_image_source as collectable_cover_image_source,
           c.kind as collectable_kind,
           cm.local_path as collectable_cover_media_path,
           um.name as manual_name, um.author as manual_author, um.type as manual_type,
           um.cover_media_path as manual_cover_media_path
    FROM event_aggregates a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
    LEFT JOIN shelves s ON s.id = a.shelf_id
    LEFT JOIN collectables c ON c.id = a.collectable_id
    LEFT JOIN media cm ON cm.id = c.cover_media_id
    LEFT JOIN user_manuals um ON um.id = a.manual_id
    WHERE a.user_id IN (SELECT friend_id FROM friend_ids) -- Friends only, no self
    AND u.is_suspended = false -- Filter out suspended users
    AND (
      -- Shelf-based events
      (a.shelf_id IS NOT NULL AND s.visibility IN ('public', 'friends'))
      OR
      -- Check-in events
      (a.event_type = 'checkin.activity' AND a.visibility IN ('public', 'friends'))
      OR
      -- Global rating/review events (always visible from friends)
      (a.shelf_id IS NULL AND a.event_type IN ('item.rated', 'reviewed'))
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
           c.cover_url as collectable_cover_url,
           c.cover_image_url as collectable_cover_image_url,
           c.cover_image_source as collectable_cover_image_source,
           c.kind as collectable_kind,
           cm.local_path as collectable_cover_media_path,
           um.name as manual_name, um.author as manual_author, um.type as manual_type,
           um.cover_media_path as manual_cover_media_path
    FROM event_aggregates a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
    LEFT JOIN shelves s ON s.id = a.shelf_id
    LEFT JOIN collectables c ON c.id = a.collectable_id
    LEFT JOIN media cm ON cm.id = c.cover_media_id
    LEFT JOIN user_manuals um ON um.id = a.manual_id
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
  logFeedMicro('logEvent.request', {
    userId: userId || null,
    shelfId: shelfId == null ? null : shelfId,
    eventType: eventType || null,
    payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
  });

  // Only check shelf visibility if shelfId is provided
  if (shelfId != null) {
    const visibilityResult = await query(
      'SELECT visibility FROM shelves WHERE id = $1',
      [shelfId]
    );
    const visibility = visibilityResult.rows[0]?.visibility || null;
    if (!visibility || visibility === 'private') {
      if (FEED_AGGREGATE_DEBUG) {
        logger.info('[feed.event] skipped private shelf', {
          shelfId,
          eventType,
          userId,
        });
      }
      logFeedMicro('logEvent.skipped.privateShelf', {
        shelfId,
        eventType,
        userId,
      });
      return null;
    }
  }

  // Non-aggregated events (missing userId or eventType)
  if (!userId || !eventType) {
    const result = await query(
      `INSERT INTO event_logs (user_id, shelf_id, event_type, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId || null, shelfId || null, eventType || null, JSON.stringify(normalizePayload(payload))]
    );
    logFeedMicro('logEvent.inserted.nonAggregated', {
      eventId: result.rows[0]?.id || null,
      eventType: eventType || null,
      shelfId: shelfId || null,
    });
    return rowToCamelCase(result.rows[0]);
  }


  return transaction(async (client) => {
    const aggregate = await getOrCreateAggregate(client, { userId, shelfId, eventType });
    logFeedMicro('logEvent.aggregate.selected', {
      aggregateId: aggregate?.id || null,
      aggregateEventType: aggregate?.event_type || null,
      requestedEventType: eventType,
      shelfId: shelfId == null ? null : shelfId,
    });
    const payloadValue = normalizePayload(payload);
    const isRatedEvent = eventType === 'item.rated';
    let persistedLogRow = null;

    if (isRatedEvent) {
      const identity = getRatedItemIdentity(payloadValue);
      const hasIdentity = identity.collectableId || identity.manualId || identity.itemId;
      let existingRow = null;

      if (hasIdentity) {
        const existingResult = await client.query(
          `SELECT id
           FROM event_logs
           WHERE aggregate_id = $1
             AND event_type = 'item.rated'
             AND (
               ($2::text IS NOT NULL AND (payload->>'collectableId' = $2::text OR payload->>'collectable_id' = $2::text))
               OR ($3::text IS NOT NULL AND (payload->>'manualId' = $3::text OR payload->>'manual_id' = $3::text))
               OR ($4::text IS NOT NULL AND (payload->>'itemId' = $4::text OR payload->>'id' = $4::text))
             )
           ORDER BY created_at DESC
           LIMIT 1
           FOR UPDATE`,
          [aggregate.id, identity.collectableId, identity.manualId, identity.itemId],
        );
        existingRow = existingResult.rows[0] || null;
      }

      if (existingRow) {
        const updateResult = await client.query(
          `UPDATE event_logs
           SET payload = $2::jsonb,
               created_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [existingRow.id, JSON.stringify(payloadValue)],
        );
        persistedLogRow = updateResult.rows[0];
      } else {
        const insertResult = await client.query(
          `INSERT INTO event_logs (user_id, shelf_id, aggregate_id, event_type, payload)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [userId, shelfId, aggregate.id, eventType, JSON.stringify(payloadValue)],
        );
        persistedLogRow = insertResult.rows[0];
      }

      await refreshRatedAggregateSummary(client, aggregate.id);

      if (FEED_AGGREGATE_DEBUG) {
        logger.info('[feed.event] logged', {
          eventId: persistedLogRow?.id,
          aggregateId: aggregate?.id,
          userId,
          shelfId,
          eventType,
        });
      }
      logFeedMicro('logEvent.logged.rated', {
        eventId: persistedLogRow?.id || null,
        aggregateId: aggregate?.id || null,
        userId,
        shelfId: shelfId == null ? null : shelfId,
        eventType,
      });

      return rowToCamelCase(persistedLogRow);
    }

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
      logger.info('[feed.event] logged', {
        eventId: insertResult.rows[0]?.id,
        aggregateId: aggregate?.id,
        userId,
        shelfId,
        eventType,
      });
    }
    logFeedMicro('logEvent.logged.generic', {
      eventId: insertResult.rows[0]?.id || null,
      aggregateId: aggregate?.id || null,
      userId,
      shelfId: shelfId == null ? null : shelfId,
      eventType,
      itemIncrement,
    });

    return rowToCamelCase(insertResult.rows[0]);
  });
}

async function upsertReviewedEvent({ userId, payload = {}, reviewedEventLogId = null }) {
  if (!userId) return null;
  const normalizedPayload = normalizePayload(payload);

  return transaction(async (client) => {
    const nowIso = new Date().toISOString();
    let existing = await getReviewedEventLogById(client, { userId, reviewedEventLogId });
    if (!existing) {
      existing = await findLatestReviewedEventLogByIdentity(client, {
        userId,
        payload: normalizedPayload,
      });
    }

    if (existing) {
      const existingPayload = normalizePayload(existing.payload);
      const mergedPayload = { ...existingPayload, ...normalizedPayload };
      const publishedAt = (
        existingPayload.reviewPublishedAt
        || existingPayload.review_published_at
        || toIsoString(existing.created_at)
        || nowIso
      );
      const previousUpdatedAt = (
        existingPayload.reviewUpdatedAt
        || existingPayload.review_updated_at
        || publishedAt
      );
      const contentChanged = (
        getReviewedContentSignature(existingPayload) !== getReviewedContentSignature(mergedPayload)
      );

      if (!contentChanged) {
        return {
          id: existing.id,
          aggregateId: existing.aggregate_id,
          createdAt: toIsoString(existing.created_at),
          reviewPublishedAt: publishedAt,
          reviewUpdatedAt: previousUpdatedAt,
          changed: false,
          createdNew: false,
          linkedExisting: true,
        };
      }

      const nextPayload = {
        ...mergedPayload,
        reviewPublishedAt: publishedAt,
        reviewUpdatedAt: nowIso,
      };
      const updateResult = await client.query(
        `UPDATE event_logs
         SET payload = $2::jsonb,
             created_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [existing.id, JSON.stringify(nextPayload)],
      );
      const updatedLog = updateResult.rows[0];

      await client.query(
        `UPDATE event_aggregates
         SET item_count = 1,
             last_activity_at = NOW(),
             preview_payloads = jsonb_build_array($2::jsonb)
         WHERE id = $1`,
        [existing.aggregate_id, JSON.stringify(nextPayload)],
      );

      logFeedMicro('upsertReviewedEvent.updated', {
        userId,
        eventLogId: updatedLog?.id || existing.id,
        aggregateId: existing.aggregate_id,
      });
      return {
        id: updatedLog?.id || existing.id,
        aggregateId: existing.aggregate_id,
        createdAt: toIsoString(updatedLog?.created_at) || nowIso,
        reviewPublishedAt: publishedAt,
        reviewUpdatedAt: nowIso,
        changed: true,
        createdNew: false,
        linkedExisting: true,
      };
    }

    const reviewPublishedAt = nowIso;
    const reviewUpdatedAt = nowIso;
    const createPayload = {
      ...normalizedPayload,
      reviewPublishedAt,
      reviewUpdatedAt,
    };

    const aggregate = await getOrCreateAggregate(client, {
      userId,
      shelfId: null,
      eventType: 'reviewed',
    });

    const insertResult = await client.query(
      `INSERT INTO event_logs (user_id, shelf_id, aggregate_id, event_type, payload)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, null, aggregate.id, 'reviewed', JSON.stringify(createPayload)],
    );
    const createdLog = insertResult.rows[0];

    await client.query(
      `UPDATE event_aggregates
       SET item_count = 1,
           last_activity_at = NOW(),
           preview_payloads = jsonb_build_array($2::jsonb)
       WHERE id = $1`,
      [aggregate.id, JSON.stringify(createPayload)],
    );

    logFeedMicro('upsertReviewedEvent.created', {
      userId,
      eventLogId: createdLog?.id || null,
      aggregateId: aggregate.id,
    });
    return {
      id: createdLog?.id || null,
      aggregateId: aggregate.id,
      createdAt: toIsoString(createdLog?.created_at) || nowIso,
      reviewPublishedAt,
      reviewUpdatedAt,
      changed: true,
      createdNew: true,
      linkedExisting: false,
    };
  });
}

/**
 * Log a check-in event (user is starting/continuing/completed with a collectable)
 */
async function logCheckIn({ userId, collectableId = null, manualId = null, status, visibility = 'public', note = null }) {
  const hasCollectable = !!collectableId;
  const hasManual = !!manualId;
  if (!userId || !status || (!hasCollectable && !hasManual) || (hasCollectable && hasManual)) {
    throw new Error('userId, status, and either collectableId or manualId are required for check-in');
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
      user_id, event_type, collectable_id, manual_id, checkin_status, visibility, note,
      window_start_utc, window_end_utc, item_count
    )
    VALUES ($1, 'checkin.activity', $2, $3, $4, $5, $6, NOW(), NOW(), 1)
    RETURNING *`,
    [userId, collectableId, manualId, status, visibility, note]
  );

  if (FEED_AGGREGATE_DEBUG) {
    logger.info('[feed.checkin] created', {
      aggregateId: result.rows[0]?.id,
      userId,
      collectableId,
      manualId,
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
  upsertReviewedEvent,
  logCheckIn,
};
