/**
 * Add composite indexes that match the friend lookup pattern used by the feed.
 *
 * The feed queries filter friendships by:
 *   WHERE status = 'accepted'
 *     AND (requester_id = $1 OR addressee_id = $1)
 *
 * Separate single-column indexes exist, but these composite indexes help Postgres
 * satisfy both the status filter and the user-id predicate efficiently.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_friendships_status_requester
    ON friendships (status, requester_id)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_friendships_status_addressee
    ON friendships (status, addressee_id)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_friendships_status_requester');
  await knex.raw('DROP INDEX IF EXISTS idx_friendships_status_addressee');
};

