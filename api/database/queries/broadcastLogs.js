const { query } = require('../pg');
const { rowToCamelCase, parsePagination } = require('./utils');

/**
 * Create a new broadcast log entry with status 'pending'
 */
async function createBroadcastLog({ title, body, metadata = null, sentByAdminId = null }) {
    const result = await query(
        `INSERT INTO broadcast_logs (title, body, metadata, sent_by_admin_id, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING *`,
        [title, body, metadata ? JSON.stringify(metadata) : null, sentByAdminId]
    );
    return rowToCamelCase(result.rows[0]);
}

/**
 * Update a broadcast log entry (status, counts, etc.)
 */
async function updateBroadcastLog(id, { status, totalTokens, successCount, errorCount } = {}) {
    const fields = [];
    const values = [];
    let idx = 1;

    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }
    if (totalTokens !== undefined) { fields.push(`total_tokens = $${idx++}`); values.push(totalTokens); }
    if (successCount !== undefined) { fields.push(`success_count = $${idx++}`); values.push(successCount); }
    if (errorCount !== undefined) { fields.push(`error_count = $${idx++}`); values.push(errorCount); }

    if (fields.length === 0) return null;

    values.push(id);
    const result = await query(
        `UPDATE broadcast_logs SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Mark a broadcast as suppressed (recall — hides in-app modal on clients)
 */
async function suppressBroadcast(id) {
    const result = await query(
        `UPDATE broadcast_logs SET is_suppressed = true WHERE id = $1 RETURNING *`,
        [id]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Get the current status and suppression flag for a broadcast
 */
async function getBroadcastStatus(id) {
    const result = await query(
        `SELECT status, is_suppressed FROM broadcast_logs WHERE id = $1`,
        [id]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * List broadcasts with pagination, ordered by most recent first
 */
async function listBroadcasts({ limit = 20, offset = 0 } = {}) {
    const { limit: safeLimit, offset: safeOffset } = parsePagination({ limit, offset });
    const result = await query(
        `SELECT bl.*
         FROM broadcast_logs bl
         ORDER BY bl.sent_at DESC
         LIMIT $1 OFFSET $2`,
        [safeLimit, safeOffset]
    );

    const countResult = await query(`SELECT COUNT(*) FROM broadcast_logs`);
    const total = parseInt(countResult.rows[0].count, 10);

    return {
        broadcasts: result.rows.map(rowToCamelCase),
        total,
    };
}

module.exports = {
    createBroadcastLog,
    updateBroadcastLog,
    suppressBroadcast,
    getBroadcastStatus,
    listBroadcasts,
};
