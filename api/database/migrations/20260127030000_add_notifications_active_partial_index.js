/**
 * Add a partial index for active notifications (deleted_at IS NULL).
 *
 * This helps both:
 * 1. Unread count: WHERE user_id = $1 AND is_read = FALSE AND deleted_at IS NULL
 * 2. Notification list: WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_notifications_active_user_read_created
    ON notifications (user_id, is_read, created_at DESC)
    WHERE deleted_at IS NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_notifications_active_user_read_created');
};

