/**
 * User Ratings database queries
 * Supports ratings for both collectables and user_manuals items
 */

const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

/**
 * Get a user's rating for a specific item (collectable or manual)
 * @param {string} userId - User UUID
 * @param {object} options - Either { collectableId } or { manualId }
 */
async function getRating(userId, { collectableId, manualId }) {
    if (collectableId) {
        const result = await query(
            `SELECT * FROM user_ratings WHERE user_id = $1 AND collectable_id = $2`,
            [userId, collectableId]
        );
        return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    }

    if (manualId) {
        const result = await query(
            `SELECT * FROM user_ratings WHERE user_id = $1 AND manual_id = $2`,
            [userId, manualId]
        );
        return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    }

    return null;
}

/**
 * Get a user's rating for a collectable (legacy compatibility)
 */
async function getRatingForCollectable(userId, collectableId) {
    return getRating(userId, { collectableId });
}

/**
 * Clean up rating value to ensure it matches constraints
 * Ensures 0-5 range and 0.5 increments
 */
function normalizeRating(rating) {
    if (rating === null || rating === undefined) return null;
    let r = parseFloat(rating);
    if (isNaN(r)) return null;

    // Clamp to 0-5
    r = Math.max(0, Math.min(5, r));

    // Round to nearest 0.5
    return Math.round(r * 2) / 2;
}

/**
 * Create or update a rating for an item (collectable or manual)
 * @param {string} userId - User UUID
 * @param {object} options - Either { collectableId } or { manualId }
 * @param {number} rating - Rating value 0-5
 */
async function setRating(userId, { collectableId, manualId }, rating) {
    const validRating = normalizeRating(rating);

    // If rating is null/cleared, delete the entry
    if (validRating === null) {
        if (collectableId) {
            await query(
                `DELETE FROM user_ratings WHERE user_id = $1 AND collectable_id = $2`,
                [userId, collectableId]
            );
        } else if (manualId) {
            await query(
                `DELETE FROM user_ratings WHERE user_id = $1 AND manual_id = $2`,
                [userId, manualId]
            );
        }
        return null;
    }

    if (collectableId) {
        const result = await query(
            `INSERT INTO user_ratings (user_id, collectable_id, rating)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, collectable_id) DO UPDATE
             SET rating = EXCLUDED.rating, updated_at = NOW()
             RETURNING *`,
            [userId, collectableId, validRating]
        );
        return rowToCamelCase(result.rows[0]);
    }

    if (manualId) {
        // Check if rating exists for manual
        const existing = await query(
            `SELECT id FROM user_ratings WHERE user_id = $1 AND manual_id = $2`,
            [userId, manualId]
        );

        if (existing.rows.length > 0) {
            // Update existing
            const result = await query(
                `UPDATE user_ratings 
                 SET rating = $1, updated_at = NOW()
                 WHERE user_id = $2 AND manual_id = $3
                 RETURNING *`,
                [validRating, userId, manualId]
            );
            return rowToCamelCase(result.rows[0]);
        } else {
            // Insert new
            const result = await query(
                `INSERT INTO user_ratings (user_id, manual_id, rating)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
                [userId, manualId, validRating]
            );
            return rowToCamelCase(result.rows[0]);
        }
    }

    return null;
}

/**
 * Set rating for a collectable (legacy compatibility)
 */
async function setRatingForCollectable(userId, collectableId, rating) {
    return setRating(userId, { collectableId }, rating);
}

/**
 * Get aggregate rating stats for a collectable
 * Note: Aggregate ratings only apply to collectables (shared catalog items)
 */
async function getAggregateRating(collectableId) {
    const result = await query(
        `SELECT 
            COUNT(*) as count,
            COALESCE(AVG(rating), 0) as average
         FROM user_ratings 
         WHERE collectable_id = $1`,
        [collectableId]
    );

    const row = result.rows[0];
    return {
        count: parseInt(row.count || 0),
        average: row.average ? parseFloat(parseFloat(row.average).toFixed(1)) : 0
    };
}

/**
 * Get all ratings by a user (for profile/export)
 * Includes both collectable and manual item ratings
 */
async function getRatingsForUser(userId, { limit = 100, offset = 0 } = {}) {
    const result = await query(
        `SELECT ur.*, 
            COALESCE(c.title, um.name) as title, 
            COALESCE(c.kind, um.type) as kind, 
            c.cover_url
         FROM user_ratings ur
         LEFT JOIN collectables c ON c.id = ur.collectable_id
         LEFT JOIN user_manuals um ON um.id = ur.manual_id
         WHERE ur.user_id = $1
         ORDER BY ur.updated_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
    );
    return result.rows.map(rowToCamelCase);
}

module.exports = {
    getRating,
    getRatingForCollectable,
    setRating,
    setRatingForCollectable,
    getAggregateRating,
    getRatingsForUser,
    normalizeRating,
};
