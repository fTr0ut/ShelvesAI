/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.boolean('is_admin').notNullable().defaultTo(false);
    table.boolean('is_suspended').notNullable().defaultTo(false);
    table.timestamp('suspended_at', { useTz: true });
    table.text('suspension_reason');
  });

  // Partial index for efficient lookup of suspended users
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_is_suspended
    ON users (is_suspended)
    WHERE is_suspended = true
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_users_is_suspended');

  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('suspension_reason');
    table.dropColumn('suspended_at');
    table.dropColumn('is_suspended');
    table.dropColumn('is_admin');
  });
};
