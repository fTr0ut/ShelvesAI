const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

async function create({ userId, shelfId, rawData, confidence }) {
    const result = await query(
        `INSERT INTO needs_review (user_id, shelf_id, raw_data, confidence)
     VALUES ($1, $2, $3, $4) RETURNING *`,
        [userId, shelfId, JSON.stringify(rawData), confidence]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function listPending(userId, shelfId) {
    const result = await query(
        `SELECT * FROM needs_review 
     WHERE user_id = $1 AND shelf_id = $2 AND status = 'pending'
     ORDER BY created_at DESC`,
        [userId, shelfId]
    );
    return result.rows.map(rowToCamelCase);
}

async function getById(id, userId) {
    const result = await query(
        `SELECT * FROM needs_review WHERE id = $1 AND user_id = $2`,
        [id, userId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function markCompleted(id, userId) {
    const result = await query(
        `UPDATE needs_review SET status = 'completed', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, userId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function dismiss(id, userId) {
    const result = await query(
        `UPDATE needs_review SET status = 'dismissed', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, userId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * List all pending review items for a user across all shelves
 * Includes shelf metadata for grouping in UI
 */
async function listAllPendingForUser(userId) {
    const result = await query(
        `SELECT nr.*, s.name as shelf_name, s.type as shelf_type
         FROM needs_review nr
         LEFT JOIN shelves s ON s.id = nr.shelf_id
         WHERE nr.user_id = $1 AND nr.status = 'pending'
         ORDER BY nr.created_at DESC`,
        [userId]
    );
    return result.rows.map(row => {
        const item = rowToCamelCase(row);
        // Attach shelf info
        item.shelfName = row.shelf_name || null;
        item.shelfType = row.shelf_type || null;
        return item;
    });
}

/**
 * Count pending review items for a user
 */
async function countPendingForUser(userId) {
    const result = await query(
        `SELECT COUNT(*) as count FROM needs_review 
         WHERE user_id = $1 AND status = 'pending'`,
        [userId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
}

/**
 * Dismiss all pending review items for a user
 * Returns the count of dismissed items
 */
async function dismissAllForUser(userId) {
    const result = await query(
        `UPDATE needs_review SET status = 'dismissed', updated_at = NOW()
         WHERE user_id = $1 AND status = 'pending'`,
        [userId]
    );
    return result.rowCount || 0;
}

/**
 * Delete expired pending review items (older than specified days)
 * Used by the cleanup job
 */
async function deleteExpired(days = 7) {
    const result = await query(
        `DELETE FROM needs_review 
         WHERE status = 'pending' 
         AND created_at < NOW() - INTERVAL '1 day' * $1
         RETURNING id`,
        [days]
    );
    return result.rowCount || 0;
}

module.exports = {
    create,
    listPending,
    getById,
    markCompleted,
    dismiss,
    listAllPendingForUser,
    countPendingForUser,
    dismissAllForUser,
    deleteExpired,
};
