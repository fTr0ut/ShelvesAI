/**
 * Shared ownership-verification helper.
 *
 * The `WHERE id = $1 AND owner_id = $2` (or `user_id = $2`) pattern was
 * repeated across shelves.js, wishlists.js, lists.js, and needsReview.js.
 * This module centralises it with an allowlist guard against SQL injection.
 */

const { query } = require('../pg');

/**
 * Tables that are permitted as the `table` argument.
 * Add a table here only when it has an `id` primary key and an ownership
 * column (see OWNER_COLUMN_MAP below).
 */
const ALLOWED_TABLES = new Set([
  'shelves',
  'wishlists',
  'user_lists',
  'needs_review',
]);

/**
 * Maps table name → the column that holds the owner's user ID.
 * Defaults to `owner_id` when not listed.
 */
const OWNER_COLUMN_MAP = {
  wishlists: 'user_id',
  user_lists: 'user_id',
  needs_review: 'user_id',
};

/**
 * Verify that a row with the given `id` is owned by `userId`.
 *
 * @param {string} table - Table name (must be in ALLOWED_TABLES).
 * @param {number|string} id - Primary key value.
 * @param {number|string} userId - User ID to check ownership against.
 * @param {import('pg').PoolClient|null} [client=null] - Optional transaction client.
 * @returns {Promise<boolean>} `true` if the row exists and is owned by `userId`.
 * @throws {Error} If `table` is not in the allowlist.
 */
async function verifyOwnership(table, id, userId, client = null) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`verifyOwnership: table "${table}" is not in the allowlist`);
  }

  const ownerColumn = OWNER_COLUMN_MAP[table] || 'owner_id';
  const q = client ? client.query.bind(client) : query;

  const result = await q(
    `SELECT id FROM ${table} WHERE id = $1 AND ${ownerColumn} = $2`,
    [id, userId]
  );

  return result.rows.length > 0;
}

module.exports = { verifyOwnership, ALLOWED_TABLES };
