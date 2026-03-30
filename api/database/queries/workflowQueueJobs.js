const { query, getClient } = require('../pg');
const { rowToCamelCase } = require('./utils');

const ACTIVE_STATUSES = ['queued', 'processing'];
const ALL_STATUSES = ['queued', 'processing', 'completed', 'failed', 'aborted'];

function toJson(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

function mapRow(row) {
  return row ? rowToCamelCase(row) : null;
}

function normalizeStatusFilter(status) {
  if (status == null || status === '') {
    return { statuses: [...ACTIVE_STATUSES], activeDefault: true };
  }

  const rawValues = Array.isArray(status) ? status : String(status).split(',');
  const normalized = rawValues
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);

  if (!normalized.length || normalized.includes('active')) {
    return { statuses: [...ACTIVE_STATUSES], activeDefault: true };
  }

  if (normalized.includes('all')) {
    return { statuses: null, activeDefault: false };
  }

  const statuses = Array.from(new Set(normalized.filter((entry) => ALL_STATUSES.includes(entry))));
  if (!statuses.length) {
    return { statuses: [...ACTIVE_STATUSES], activeDefault: true };
  }

  return { statuses, activeDefault: false };
}

function normalizeAdminFilterInput({
  limit = 50,
  offset = 0,
  status = null,
  workflowType = null,
  userId = null,
  shelfId = null,
  jobId = null,
} = {}) {
  const parsedLimit = Number.parseInt(String(limit), 10);
  const parsedOffset = Number.parseInt(String(offset), 10);
  const parsedShelfId = shelfId == null || shelfId === '' ? null : Number.parseInt(String(shelfId), 10);

  const safeLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 200)) : 50;
  const safeOffset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;

  return {
    limit: safeLimit,
    offset: safeOffset,
    status,
    workflowType: workflowType == null || workflowType === '' ? null : String(workflowType).trim(),
    userId: userId == null || userId === '' ? null : String(userId).trim(),
    shelfId: Number.isFinite(parsedShelfId) ? parsedShelfId : null,
    jobId: jobId == null || jobId === '' ? null : String(jobId).trim(),
  };
}

function buildAdminFilterSql(filters) {
  const clauses = [];
  const params = [];

  const { statuses, activeDefault } = normalizeStatusFilter(filters.status);
  if (Array.isArray(statuses) && statuses.length) {
    params.push(statuses);
    clauses.push(`j.status = ANY($${params.length}::text[])`);
  }

  if (filters.workflowType) {
    params.push(filters.workflowType);
    clauses.push(`j.workflow_type = $${params.length}`);
  }

  if (filters.userId) {
    params.push(filters.userId);
    clauses.push(`j.user_id = $${params.length}::uuid`);
  }

  if (filters.shelfId != null) {
    params.push(filters.shelfId);
    clauses.push(`j.shelf_id = $${params.length}`);
  }

  if (filters.jobId) {
    params.push(`%${filters.jobId}%`);
    clauses.push(`j.job_id ILIKE $${params.length}`);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
    activeDefault,
  };
}

function buildActiveDefaultOrderSql() {
  return `
    ORDER BY
      CASE
        WHEN j.status = 'processing' THEN 0
        WHEN j.status = 'queued' THEN 1
        ELSE 2
      END ASC,
      CASE WHEN j.status = 'processing' THEN j.updated_at ELSE NULL END DESC NULLS LAST,
      CASE WHEN j.status = 'queued' THEN j.priority ELSE NULL END ASC NULLS LAST,
      CASE WHEN j.status = 'queued' THEN j.created_at ELSE NULL END ASC NULLS LAST,
      j.updated_at DESC,
      j.job_id ASC
  `;
}

function buildDefaultOrderSql() {
  return `ORDER BY j.updated_at DESC, j.job_id DESC`;
}

function buildAdminSelectColumnsSql() {
  return `
    j.*,
    CASE
      WHEN j.status = 'queued' THEN (
        SELECT COUNT(*)::int
        FROM workflow_queue_jobs ahead
        WHERE ahead.workflow_type = j.workflow_type
          AND ahead.status = 'queued'
          AND (
            ahead.priority < j.priority
            OR (
              ahead.priority = j.priority
              AND (
                ahead.created_at < j.created_at
                OR (ahead.created_at = j.created_at AND ahead.job_id < j.job_id)
              )
            )
          )
      ) + 1
      ELSE 0
    END AS queue_position,
    CASE
      WHEN j.status IN ('queued', 'processing') THEN FLOOR(EXTRACT(EPOCH FROM (NOW() - j.created_at)) * 1000)::bigint
      ELSE 0::bigint
    END AS queued_ms
  `;
}

async function enqueueJob({
  jobId,
  workflowType,
  userId,
  shelfId = null,
  status = 'queued',
  priority = 100,
  maxAttempts = 1,
  payload = {},
  dedupeKey = null,
  notifyOnComplete = false,
}) {
  const result = await query(
    `INSERT INTO workflow_queue_jobs (
       job_id,
       workflow_type,
       user_id,
       shelf_id,
       status,
       priority,
       attempt_count,
       max_attempts,
       payload,
       dedupe_key,
       notify_on_complete,
       abort_requested,
       created_at,
       updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 0, $7, $8::jsonb, $9, $10, FALSE, NOW(), NOW()
     )
     RETURNING *`,
    [
      jobId,
      workflowType,
      userId,
      shelfId,
      status,
      priority,
      Math.max(1, Number(maxAttempts) || 1),
      toJson(payload || {}),
      dedupeKey,
      notifyOnComplete === true,
    ]
  );
  return mapRow(result.rows[0]);
}

async function findActiveByDedupeKey({ workflowType, dedupeKey }) {
  if (!workflowType || !dedupeKey) return null;
  const result = await query(
    `SELECT *
     FROM workflow_queue_jobs
     WHERE workflow_type = $1
       AND dedupe_key = $2
       AND status = ANY($3::text[])
     ORDER BY created_at ASC
     LIMIT 1`,
    [workflowType, dedupeKey, ACTIVE_STATUSES]
  );
  return mapRow(result.rows[0]);
}

async function getByJobId(jobId) {
  const result = await query(
    `SELECT *
     FROM workflow_queue_jobs
     WHERE job_id = $1
     LIMIT 1`,
    [jobId]
  );
  return mapRow(result.rows[0]);
}

async function getByJobIdForUser({ jobId, userId }) {
  const result = await query(
    `SELECT *
     FROM workflow_queue_jobs
     WHERE job_id = $1
       AND user_id = $2
     LIMIT 1`,
    [jobId, userId]
  );
  return mapRow(result.rows[0]);
}

async function countQueuedForUser({ workflowType, userId }) {
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM workflow_queue_jobs
     WHERE workflow_type = $1
       AND user_id = $2
       AND status = 'queued'`,
    [workflowType, userId]
  );
  return Number(result.rows[0]?.count || 0);
}

async function countQueued({ workflowType }) {
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM workflow_queue_jobs
     WHERE workflow_type = $1
       AND status = 'queued'`,
    [workflowType]
  );
  return Number(result.rows[0]?.count || 0);
}

async function countRunning({ workflowType }) {
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM workflow_queue_jobs
     WHERE workflow_type = $1
       AND status = 'processing'`,
    [workflowType]
  );
  return Number(result.rows[0]?.count || 0);
}

async function getQueuePosition(jobId) {
  const result = await query(
    `WITH target AS (
       SELECT job_id, workflow_type, priority, created_at
       FROM workflow_queue_jobs
       WHERE job_id = $1
       LIMIT 1
     )
     SELECT
       CASE
         WHEN t.job_id IS NULL THEN NULL
         WHEN q.status <> 'queued' THEN 0
         ELSE (
           SELECT COUNT(*)::int
           FROM workflow_queue_jobs ahead
           WHERE ahead.workflow_type = q.workflow_type
             AND ahead.status = 'queued'
             AND (
               ahead.priority < q.priority
               OR (
                 ahead.priority = q.priority
                 AND (
                   ahead.created_at < q.created_at
                   OR (ahead.created_at = q.created_at AND ahead.job_id < q.job_id)
                 )
               )
             )
         ) + 1
       END AS position
     FROM target t
     JOIN workflow_queue_jobs q ON q.job_id = t.job_id`,
    [jobId]
  );
  if (!result.rows[0]) return null;
  const raw = result.rows[0].position;
  if (raw == null) return null;
  return Number(raw);
}

async function claimNextRunnable({
  workflowType,
  maxRunning = 2,
  maxRunningPerUser = 1,
}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const lockResult = await client.query(
      `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired`,
      [`workflow_queue_claim:${workflowType}`]
    );
    const acquired = lockResult.rows[0]?.acquired === true;
    if (!acquired) {
      await client.query('COMMIT');
      return null;
    }

    const runningResult = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM workflow_queue_jobs
       WHERE workflow_type = $1
         AND status = 'processing'`,
      [workflowType]
    );
    const runningCount = Number(runningResult.rows[0]?.count || 0);
    if (runningCount >= Math.max(1, Number(maxRunning) || 1)) {
      await client.query('COMMIT');
      return null;
    }

    const result = await client.query(
      `WITH user_running AS (
         SELECT user_id, COUNT(*)::int AS running_count
         FROM workflow_queue_jobs
         WHERE workflow_type = $1
           AND status = 'processing'
         GROUP BY user_id
       ),
       candidate AS (
         SELECT q.job_id
         FROM workflow_queue_jobs q
         LEFT JOIN user_running ur ON ur.user_id = q.user_id
         WHERE q.workflow_type = $1
           AND q.status = 'queued'
           AND q.attempt_count < q.max_attempts
           AND COALESCE(ur.running_count, 0) < $2
         ORDER BY q.priority ASC, q.created_at ASC, q.job_id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE workflow_queue_jobs AS j
       SET status = 'processing',
           attempt_count = j.attempt_count + 1,
           claimed_at = NOW(),
           started_at = COALESCE(j.started_at, NOW()),
           updated_at = NOW(),
           error = NULL
       FROM candidate
       WHERE j.job_id = candidate.job_id
       RETURNING j.*`,
      [
        workflowType,
        Math.max(1, Number(maxRunningPerUser) || 1),
      ]
    );

    await client.query('COMMIT');
    return mapRow(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function markCompleted({ jobId, result = {} }) {
  const response = await query(
    `UPDATE workflow_queue_jobs
     SET status = 'completed',
         result = $2::jsonb,
         error = NULL,
         abort_requested = FALSE,
         finished_at = NOW(),
         updated_at = NOW()
     WHERE job_id = $1
     RETURNING *`,
    [jobId, toJson(result || {})]
  );
  return mapRow(response.rows[0]);
}

async function markFailedOrRequeue({ jobId, error = {} }) {
  const response = await query(
    `UPDATE workflow_queue_jobs
     SET status = CASE
                    WHEN abort_requested THEN 'aborted'
                    WHEN attempt_count < max_attempts THEN 'queued'
                    ELSE 'failed'
                  END,
         error = $2::jsonb,
         claimed_at = CASE
                        WHEN abort_requested THEN claimed_at
                        WHEN attempt_count < max_attempts THEN NULL
                        ELSE claimed_at
                      END,
         finished_at = CASE
                         WHEN abort_requested THEN NOW()
                         WHEN attempt_count < max_attempts THEN NULL
                         ELSE NOW()
                       END,
         updated_at = NOW()
     WHERE job_id = $1
     RETURNING *`,
    [jobId, toJson(error || {})]
  );
  return mapRow(response.rows[0]);
}

async function requestAbort({ jobId, userId = null }) {
  const params = [jobId];
  let userFilter = '';
  if (userId) {
    params.push(userId);
    userFilter = `AND user_id = $${params.length}`;
  }

  const response = await query(
    `UPDATE workflow_queue_jobs
     SET abort_requested = TRUE,
         status = CASE WHEN status = 'queued' THEN 'aborted' ELSE status END,
         finished_at = CASE WHEN status = 'queued' THEN NOW() ELSE finished_at END,
         updated_at = NOW()
     WHERE job_id = $1
       ${userFilter}
     RETURNING *`,
    params
  );
  return mapRow(response.rows[0]);
}

async function updateNotifyOnComplete({ jobId, notifyOnComplete }) {
  const response = await query(
    `UPDATE workflow_queue_jobs
     SET notify_on_complete = $2,
         updated_at = NOW()
     WHERE job_id = $1
     RETURNING *`,
    [jobId, notifyOnComplete === true]
  );
  return mapRow(response.rows[0]);
}

async function isAbortRequested(jobId) {
  const result = await query(
    `SELECT abort_requested
     FROM workflow_queue_jobs
     WHERE job_id = $1
     LIMIT 1`,
    [jobId]
  );
  return result.rows[0]?.abort_requested === true;
}

async function cleanupTerminalJobs({ olderThanMs = 24 * 60 * 60 * 1000 } = {}) {
  const safeMs = Math.max(60 * 1000, Number(olderThanMs) || 24 * 60 * 60 * 1000);
  const result = await query(
    `DELETE FROM workflow_queue_jobs
     WHERE status IN ('completed', 'failed', 'aborted')
       AND updated_at < NOW() - ($1::text || ' milliseconds')::interval`,
    [String(Math.floor(safeMs))]
  );
  return result.rowCount || 0;
}

async function listAdminWorkfeed(input = {}) {
  const filters = normalizeAdminFilterInput(input);
  const { whereSql, params, activeDefault } = buildAdminFilterSql(filters);

  const countResult = await query(
    `SELECT COUNT(*)::int AS count
     FROM workflow_queue_jobs j
     ${whereSql}`,
    params
  );
  const total = Number(countResult.rows[0]?.count || 0);

  const dataParams = [...params, filters.limit, filters.offset];
  const orderSql = activeDefault ? buildActiveDefaultOrderSql() : buildDefaultOrderSql();

  const dataResult = await query(
    `SELECT ${buildAdminSelectColumnsSql()}
     FROM workflow_queue_jobs j
     ${whereSql}
     ${orderSql}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams
  );

  return {
    jobs: dataResult.rows.map(mapRow),
    total,
    hasMore: filters.offset + dataResult.rows.length < total,
    activeDefault,
    limit: filters.limit,
    offset: filters.offset,
  };
}

async function getAdminWorkfeedJob(jobId) {
  if (!jobId) return null;

  const result = await query(
    `SELECT ${buildAdminSelectColumnsSql()}
     FROM workflow_queue_jobs j
     WHERE j.job_id = $1
     LIMIT 1`,
    [jobId]
  );
  return mapRow(result.rows[0]);
}

module.exports = {
  enqueueJob,
  findActiveByDedupeKey,
  getByJobId,
  getByJobIdForUser,
  countQueuedForUser,
  countQueued,
  countRunning,
  getQueuePosition,
  claimNextRunnable,
  markCompleted,
  markFailedOrRequeue,
  requestAbort,
  updateNotifyOnComplete,
  isAbortRequested,
  cleanupTerminalJobs,
  listAdminWorkfeed,
  getAdminWorkfeedJob,
};
