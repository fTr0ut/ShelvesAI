/**
 * User Ratings database queries
 */

const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

/**
 * Get a user's rating for a specific collectable
 */
async function getRating(userId, collectableId) {
    const result = await query(
        `SELECT * FROM user_ratings WHERE user_id = $1 AND collectable_id = $2`,
        [userId, collectableId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
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
 * Create or update a rating
 */
async function setRating(userId, collectableId, rating) {
    const validRating = normalizeRating(rating);

    // If rating is null/cleared, delete the entry
    if (validRating === null) {
        await query(
            `DELETE FROM user_ratings WHERE user_id = $1 AND collectable_id = $2`,
            [userId, collectableId]
        );
        return null;
    }

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

/**
 * Get aggregate rating stats for a collectable
 */
async function getAggregateRating(collectableId) {
    const result = await query(
        `SELECT 
            COUNT(*) as count,
            AVG(rating) as average,
            json_object_agg(rating, count) as distribution
         FROM user_ratings 
         WHERE collectable_id = $1`,
        [collectableId]
    );

    const row = result.rows[0];
    return {
        count: parseInt(row.count || 0),
        average: row.average ? parseFloat(parseFloat(row.average).toFixed(1)) : 0,
        distribution: row.distribution || {}
    };
}

/**
 * Get all ratings by a user (for profile/export)
 */
async function getRatingsForUser(userId, { limit = 100, offset = 0 } = {}) {
    const result = await query(
        `SELECT ur.*, 
            c.title, c.kind, c.cover_url
         FROM user_ratings ur
         JOIN collectables c ON c.id = ur.collectable_id
         WHERE ur.user_id = $1
         ORDER BY ur.updated_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
    );
    return result.rows.map(rowToCamelCase);
}

module.exports = {
    getRating,
    setRating,
    getAggregateRating,
    getRatingsForUser,
};
