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

module.exports = { create, listPending, getById, markCompleted, dismiss };
