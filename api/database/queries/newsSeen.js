/**
 * Query functions for tracking seen/dismissed news items
 */
const { query } = require('../pg');

/**
 * Mark a news item as seen/dismissed for a user
 * @param {string} userId - User UUID
 * @param {number} newsItemId - News item ID
 * @returns {Promise<boolean>} - True if inserted, false if already existed
 */
async function markNewsItemSeen(userId, newsItemId) {
    if (!userId || !newsItemId) return false;

    const result = await query(
        `INSERT INTO user_news_seen (user_id, news_item_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, news_item_id) DO NOTHING
         RETURNING id`,
        [userId, newsItemId]
    );

    return result.rowCount > 0;
}

/**
 * Get all seen news item IDs for a user
 * @param {string} userId - User UUID
 * @returns {Promise<number[]>} - Array of seen news item IDs
 */
async function getSeenNewsItemIds(userId) {
    if (!userId) return [];

    const result = await query(
        `SELECT news_item_id FROM user_news_seen WHERE user_id = $1`,
        [userId]
    );

    return result.rows.map(row => row.news_item_id);
}

/**
 * Clear all seen news items for a user (reset)
 * @param {string} userId - User UUID
 * @returns {Promise<number>} - Number of rows deleted
 */
async function clearSeenNewsItems(userId) {
    if (!userId) return 0;

    const result = await query(
        `DELETE FROM user_news_seen WHERE user_id = $1`,
        [userId]
    );

    return result.rowCount;
}

module.exports = {
    markNewsItemSeen,
    getSeenNewsItemIds,
    clearSeenNewsItems,
};
