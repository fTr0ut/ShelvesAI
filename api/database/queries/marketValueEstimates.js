/**
 * User market value estimate queries
 * Supports estimates for both collectables and user_manuals items
 */

const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

/**
 * Get a user's market value estimate for a specific item
 * @param {string} userId - User UUID
 * @param {object} options - Either { collectableId } or { manualId }
 */
async function getEstimate(userId, { collectableId, manualId }) {
    if (collectableId) {
        const result = await query(
            `SELECT * FROM user_market_value_estimates WHERE user_id = $1 AND collectable_id = $2`,
            [userId, collectableId]
        );
        return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    }

    if (manualId) {
        const result = await query(
            `SELECT * FROM user_market_value_estimates WHERE user_id = $1 AND manual_id = $2`,
            [userId, manualId]
        );
        return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    }

    return null;
}

/**
 * Create or update a user's market value estimate
 * @param {string} userId - User UUID
 * @param {object} options - Either { collectableId } or { manualId }
 * @param {string} estimateValue - Estimate text (e.g. "USD $50")
 */
async function setEstimate(userId, { collectableId, manualId }, estimateValue) {
    if (!estimateValue || typeof estimateValue !== 'string' || !estimateValue.trim()) {
        return deleteEstimate(userId, { collectableId, manualId });
    }

    const trimmed = estimateValue.trim();

    if (collectableId) {
        const result = await query(
            `INSERT INTO user_market_value_estimates (user_id, collectable_id, estimate_value)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, collectable_id) WHERE collectable_id IS NOT NULL
             DO UPDATE SET estimate_value = EXCLUDED.estimate_value, updated_at = NOW()
             RETURNING *`,
            [userId, collectableId, trimmed]
        );
        return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    }

    if (manualId) {
        const existing = await getEstimate(userId, { manualId });
        if (existing) {
            const result = await query(
                `UPDATE user_market_value_estimates
                 SET estimate_value = $1, updated_at = NOW()
                 WHERE user_id = $2 AND manual_id = $3
                 RETURNING *`,
                [trimmed, userId, manualId]
            );
            return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
        }
        const result = await query(
            `INSERT INTO user_market_value_estimates (user_id, manual_id, estimate_value)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [userId, manualId, trimmed]
        );
        return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    }

    return null;
}

/**
 * Delete a user's market value estimate
 * @param {string} userId - User UUID
 * @param {object} options - Either { collectableId } or { manualId }
 */
async function deleteEstimate(userId, { collectableId, manualId }) {
    if (collectableId) {
        await query(
            `DELETE FROM user_market_value_estimates WHERE user_id = $1 AND collectable_id = $2`,
            [userId, collectableId]
        );
    } else if (manualId) {
        await query(
            `DELETE FROM user_market_value_estimates WHERE user_id = $1 AND manual_id = $2`,
            [userId, manualId]
        );
    }
    return null;
}

module.exports = {
    getEstimate,
    setEstimate,
    deleteEstimate,
};
