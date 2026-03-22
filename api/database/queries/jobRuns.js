const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

function normalizeMetadata(metadata) {
  return metadata && typeof metadata === 'object' ? metadata : {};
}

async function startJobRun({
  jobId,
  jobType,
  jobName = null,
  userId = null,
  httpMethod = null,
  httpPath = null,
  ipAddress = null,
  metadata = {},
  startedAt = null,
}) {
  const safeMetadata = normalizeMetadata(metadata);
  const started = startedAt || new Date();
  await query(
    `INSERT INTO job_runs (
      job_id, job_type, job_name, user_id, status,
      http_method, http_path, ip_address, metadata,
      started_at, finished_at, success, http_status, duration_ms, error_message
    ) VALUES (
      $1, $2, $3, $4, 'running',
      $5, $6, $7, $8::jsonb,
      $9, NULL, NULL, NULL, NULL, NULL
    )
    ON CONFLICT (job_id)
    DO UPDATE SET
      job_type = EXCLUDED.job_type,
      job_name = EXCLUDED.job_name,
      user_id = EXCLUDED.user_id,
      status = 'running',
      http_method = EXCLUDED.http_method,
      http_path = EXCLUDED.http_path,
      ip_address = EXCLUDED.ip_address,
      metadata = COALESCE(job_runs.metadata, '{}'::jsonb) || EXCLUDED.metadata,
      started_at = EXCLUDED.started_at,
      finished_at = NULL,
      success = NULL,
      http_status = NULL,
      duration_ms = NULL,
      error_message = NULL,
      updated_at = NOW()`,
    [
      jobId,
      jobType,
      jobName,
      userId,
      httpMethod,
      httpPath,
      ipAddress,
      JSON.stringify(safeMetadata),
      started,
    ]
  );
}

async function completeJobRun({
  jobId,
  userId = null,
  success = true,
  httpStatus = null,
  durationMs = null,
  metadata = {},
  finishedAt = null,
}) {
  const safeMetadata = normalizeMetadata(metadata);
  await query(
    `UPDATE job_runs
     SET status = CASE WHEN $3 THEN 'completed' ELSE 'failed' END,
         success = $3,
         user_id = COALESCE($2::uuid, user_id),
         http_status = COALESCE($4, http_status),
         duration_ms = COALESCE($5, duration_ms),
         metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb,
         finished_at = COALESCE($7, NOW()),
         updated_at = NOW()
     WHERE job_id = $1`,
    [jobId, userId, !!success, httpStatus, durationMs, JSON.stringify(safeMetadata), finishedAt]
  );
}

async function failJobRun({
  jobId,
  userId = null,
  httpStatus = null,
  durationMs = null,
  errorMessage = null,
  metadata = {},
  finishedAt = null,
}) {
  const safeMetadata = normalizeMetadata(metadata);
  await query(
    `UPDATE job_runs
     SET status = 'failed',
         success = false,
         user_id = COALESCE($2::uuid, user_id),
         http_status = COALESCE($3, http_status),
         duration_ms = COALESCE($4, duration_ms),
         error_message = COALESCE($5, error_message),
         metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb,
         finished_at = COALESCE($7, NOW()),
         updated_at = NOW()
     WHERE job_id = $1`,
    [jobId, userId, httpStatus, durationMs, errorMessage, JSON.stringify(safeMetadata), finishedAt]
  );
}

async function appendJobEvent({
  jobId,
  level = 'info',
  message,
  userId = null,
  metadata = {},
  createdAt = null,
}) {
  const safeMetadata = normalizeMetadata(metadata);
  const result = await query(
    `INSERT INTO job_events (job_id, level, message, user_id, metadata, created_at)
     SELECT $1, $2, $3, $4, $5::jsonb, COALESCE($6, NOW())
     WHERE EXISTS (SELECT 1 FROM job_runs WHERE job_id = $1)`,
    [jobId, level, message, userId, JSON.stringify(safeMetadata), createdAt]
  );
  return result.rowCount > 0;
}

async function getJobRun(jobId) {
  const result = await query(
    `SELECT *
     FROM job_runs
     WHERE job_id = $1`,
    [jobId]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function getJobEvents(jobId, { limit = 200 } = {}) {
  const cappedLimit = Math.max(1, Math.min(limit, 1000));
  const result = await query(
    `SELECT id, job_id, level, message, user_id, metadata, created_at
     FROM job_events
     WHERE job_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [jobId, cappedLimit]
  );
  return result.rows.map(rowToCamelCase);
}

async function listJobRuns({
  limit = 50,
  offset = 0,
  status = null,
  jobType = null,
  userId = null,
  jobId = null,
} = {}) {
  const cappedLimit = Math.max(1, Math.min(limit, 200));
  const safeOffset = Math.max(0, offset);
  const clauses = [];
  const params = [];
  let i = 1;

  if (status) {
    clauses.push(`status = $${i++}`);
    params.push(status);
  }
  if (jobType) {
    clauses.push(`job_type = $${i++}`);
    params.push(jobType);
  }
  if (userId) {
    clauses.push(`user_id = $${i++}`);
    params.push(userId);
  }
  if (jobId) {
    clauses.push(`job_id ILIKE $${i++}`);
    params.push(`%${jobId}%`);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const countSql = `SELECT COUNT(*)::int AS count FROM job_runs ${whereSql}`;
  const countResult = await query(countSql, params);
  const total = countResult.rows[0]?.count || 0;

  const dataParams = [...params, cappedLimit, safeOffset];
  const dataSql = `
    SELECT *
    FROM job_runs
    ${whereSql}
    ORDER BY started_at DESC
    LIMIT $${i++} OFFSET $${i}
  `;
  const result = await query(dataSql, dataParams);

  return {
    jobs: result.rows.map(rowToCamelCase),
    total,
    hasMore: safeOffset + result.rows.length < total,
  };
}

module.exports = {
  startJobRun,
  completeJobRun,
  failJobRun,
  appendJobEvent,
  getJobRun,
  getJobEvents,
  listJobRuns,
};
