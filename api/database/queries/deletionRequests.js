const { query, transaction } = require('../pg');
const { rowToCamelCase } = require('./utils');

async function createDeletionRequest(userId, reason) {
  const result = await query(
    `INSERT INTO deletion_requests (user_id, reason)
     VALUES ($1, $2)
     RETURNING *`,
    [userId, reason || null]
  );
  return rowToCamelCase(result.rows[0]);
}

async function getPendingRequestByUserId(userId) {
  const result = await query(
    `SELECT * FROM deletion_requests WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  );
  return result.rows.length > 0 ? rowToCamelCase(result.rows[0]) : null;
}

async function revokeDeletionRequest(userId) {
  const result = await query(
    `DELETE FROM deletion_requests
     WHERE user_id = $1 AND status = 'pending'
     RETURNING id`,
    [userId]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

async function listDeletionRequests({ status, page = 0, limit = 20 }) {
  const offset = page * limit;
  const conditions = [];
  const values = [];

  if (status) {
    values.push(status);
    conditions.push(`dr.status = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(limit);
  values.push(offset);

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT dr.id, dr.reason, dr.status, dr.reviewer_note, dr.processed_at, dr.created_at,
              u.id as user_id, u.username, u.email,
              rv.username as reviewed_by_username
       FROM deletion_requests dr
       JOIN users u ON u.id = dr.user_id
       LEFT JOIN users rv ON rv.id = dr.reviewed_by
       ${where}
       ORDER BY dr.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    ),
    query(
      `SELECT COUNT(*) as count FROM deletion_requests dr ${where}`,
      values.slice(0, values.length - 2)
    ),
  ]);

  return {
    requests: rows.rows.map(rowToCamelCase),
    total: parseInt(countRow.rows[0].count),
  };
}

async function getDeletionRequestById(id) {
  const result = await query(
    `SELECT dr.id, dr.reason, dr.status, dr.reviewer_note, dr.processed_at, dr.created_at,
            u.id as user_id, u.username, u.email,
            rv.username as reviewed_by_username
     FROM deletion_requests dr
     JOIN users u ON u.id = dr.user_id
     LEFT JOIN users rv ON rv.id = dr.reviewed_by
     WHERE dr.id = $1`,
    [id]
  );
  return result.rows.length > 0 ? rowToCamelCase(result.rows[0]) : null;
}

async function updateDeletionRequestStatus(id, status, reviewedBy, reviewerNote, adminContext = {}) {
  return transaction(async (client) => {
    const result = await client.query(
      `UPDATE deletion_requests
       SET status = $2,
           reviewed_by = $3,
           reviewer_note = $4,
           processed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status, reviewedBy, reviewerNote || null]
    );

    if (result.rows.length === 0) return null;

    const action = status === 'approved'
      ? 'DELETION_REQUEST_APPROVED'
      : 'DELETION_REQUEST_REJECTED';

    const row = result.rows[0];

    // Snapshot the user's identity before any deletion so it can be embedded
    // in audit metadata. The audit log FK constraints have been dropped, so the
    // target_user_id UUID is retained permanently — but the username/email are
    // also stored in metadata as a human-readable fallback for the UI.
    const userResult = await client.query(
      'SELECT username, email FROM users WHERE id = $1',
      [row.user_id]
    );
    const userSnapshot = userResult.rows[0] || {};

    // Backfill identity into ALL prior audit log entries for this user so
    // history remains readable after the user row is gone.
    if (status === 'approved' && userSnapshot.username) {
      await client.query(
        `UPDATE admin_action_logs
         SET metadata = metadata || $1::jsonb
         WHERE target_user_id = $2
           AND (metadata->>'targetUsername' IS NULL OR metadata->>'targetUsername' = '')`,
        [
          JSON.stringify({
            targetUsername: userSnapshot.username,
            targetEmail: userSnapshot.email || null,
          }),
          row.user_id,
        ]
      );
    }

    await client.query(
      `INSERT INTO admin_action_logs (admin_id, action, target_user_id, metadata, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        reviewedBy,
        action,
        row.user_id,
        JSON.stringify({
          requestId: id,
          reviewerNote: reviewerNote || null,
          targetUsername: userSnapshot.username || null,
          targetEmail: userSnapshot.email || null,
        }),
        adminContext.ipAddress || null,
        adminContext.userAgent || null,
      ]
    );

    if (status === 'approved') {
      await client.query('DELETE FROM users WHERE id = $1', [row.user_id]);
    }

    return rowToCamelCase(row);
  });
}

module.exports = {
  createDeletionRequest,
  getPendingRequestByUserId,
  revokeDeletionRequest,
  listDeletionRequests,
  getDeletionRequestById,
  updateDeletionRequestStatus,
};
