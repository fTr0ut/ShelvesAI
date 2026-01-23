/**
 * Query functions for tracking dismissed news items
 */
const { query } = require('../pg');

/**
 * Mark a news item as dismissed for a user
 * @param {string} userId - User UUID
 * @param {number} newsItemId - News item ID
 * @returns {Promise<boolean>} - True if inserted, false if already existed
 */
async function markNewsItemDismissed(userId, newsItemId) {
  if (!userId || !newsItemId) return false;

  const result = await query(
    `INSERT INTO user_news_dismissed (user_id, news_item_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, news_item_id) DO NOTHING
     RETURNING id`,
    [userId, newsItemId]
  );

  return result.rowCount > 0;
}

/**
 * Mark multiple news items as dismissed for a user
 * @param {string} userId - User UUID
 * @param {number[]} newsItemIds - News item IDs
 * @returns {Promise<number>} - Number of inserted rows
 */
async function markNewsItemsDismissed(userId, newsItemIds) {
  if (!userId || !Array.isArray(newsItemIds) || newsItemIds.length === 0) return 0;

  const uniqueIds = Array.from(new Set(
    newsItemIds
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isFinite(id))
  ));

  if (!uniqueIds.length) return 0;

  const result = await query(
    `INSERT INTO user_news_dismissed (user_id, news_item_id)
     SELECT $1, UNNEST($2::int[])
     ON CONFLICT (user_id, news_item_id) DO NOTHING`,
    [userId, uniqueIds]
  );

  return result.rowCount;
}

/**
 * Get all dismissed news item IDs for a user
 * @param {string} userId - User UUID
 * @returns {Promise<number[]>} - Array of dismissed news item IDs
 */
async function getDismissedNewsItemIds(userId) {
  if (!userId) return [];

  const result = await query(
    `SELECT news_item_id FROM user_news_dismissed WHERE user_id = $1`,
    [userId]
  );

  return result.rows.map(row => row.news_item_id);
}

/**
 * Clear all dismissed news items for a user (reset)
 * @param {string} userId - User UUID
 * @returns {Promise<number>} - Number of rows deleted
 */
async function clearDismissedNewsItems(userId) {
  if (!userId) return 0;

  const result = await query(
    `DELETE FROM user_news_dismissed WHERE user_id = $1`,
    [userId]
  );

  return result.rowCount;
}

module.exports = {
  markNewsItemDismissed,
  markNewsItemsDismissed,
  getDismissedNewsItemIds,
  clearDismissedNewsItems,
};
