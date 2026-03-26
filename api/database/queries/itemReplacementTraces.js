const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

function resolveQuery(client) {
  return client ? client.query.bind(client) : query;
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function toJsonb(value) {
  return JSON.stringify(normalizeMetadata(value));
}

async function createIntent(
  {
    userId,
    shelfId,
    sourceItemId,
    sourceCollectableId = null,
    sourceManualId = null,
    triggerSource,
    metadata = {},
  },
  client = null,
) {
  if (!userId || !shelfId || !sourceItemId || !triggerSource) {
    throw new Error('Missing required replacement intent fields');
  }

  const q = resolveQuery(client);
  const result = await q(
    `INSERT INTO item_replacement_traces (
       user_id,
       shelf_id,
       source_item_id,
       source_collectable_id,
       source_manual_id,
       trigger_source,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [
      userId,
      shelfId,
      sourceItemId,
      sourceCollectableId,
      sourceManualId,
      triggerSource,
      toJsonb(metadata),
    ],
  );

  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function getByIdForUser(
  {
    traceId,
    userId,
    shelfId = null,
    sourceItemId = null,
    status = null,
    forUpdate = false,
  },
  client = null,
) {
  if (!traceId || !userId) return null;

  const q = resolveQuery(client);
  const filters = ['id = $1', 'user_id = $2'];
  const values = [traceId, userId];

  if (shelfId != null) {
    values.push(shelfId);
    filters.push(`shelf_id = $${values.length}`);
  }

  if (sourceItemId != null) {
    values.push(sourceItemId);
    filters.push(`source_item_id = $${values.length}`);
  }

  if (status != null) {
    values.push(status);
    filters.push(`status = $${values.length}`);
  }

  const sql = `SELECT * FROM item_replacement_traces WHERE ${filters.join(' AND ')}${forUpdate ? ' FOR UPDATE' : ''}`;
  const result = await q(sql, values);
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function markCompleted(
  {
    traceId,
    userId,
    targetItemId,
    targetCollectableId = null,
    targetManualId = null,
    metadata = {},
  },
  client = null,
) {
  if (!traceId || !userId || !targetItemId) {
    throw new Error('Missing required replacement completion fields');
  }

  const q = resolveQuery(client);
  const result = await q(
    `UPDATE item_replacement_traces
     SET
       status = 'completed',
       target_item_id = $3,
       target_collectable_id = $4,
       target_manual_id = $5,
       completed_at = NOW(),
       metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb
     WHERE id = $1
       AND user_id = $2
       AND status = 'initiated'
     RETURNING *`,
    [traceId, userId, targetItemId, targetCollectableId, targetManualId, toJsonb(metadata)],
  );

  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function markFailed(
  {
    traceId,
    userId,
    reason = null,
    metadata = {},
  },
  client = null,
) {
  if (!traceId || !userId) return null;

  const q = resolveQuery(client);
  const mergedMetadata = {
    ...normalizeMetadata(metadata),
    ...(reason ? { failureReason: String(reason) } : {}),
  };

  const result = await q(
    `UPDATE item_replacement_traces
     SET
       status = 'failed',
       metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
     WHERE id = $1
       AND user_id = $2
       AND status = 'initiated'
     RETURNING *`,
    [traceId, userId, toJsonb(mergedMetadata)],
  );

  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

module.exports = {
  createIntent,
  getByIdForUser,
  markCompleted,
  markFailed,
};
