/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('admin_action_logs', (table) => {
    table.increments('id').primary();
    table.uuid('admin_id').references('id').inTable('users').onDelete('SET NULL');
    table.text('action').notNullable();
    table.uuid('target_user_id').references('id').inTable('users').onDelete('SET NULL');
    table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.text('ip_address');
    table.text('user_agent');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('admin_action_logs', (table) => {
    table.index(['admin_id'], 'idx_admin_action_logs_admin_id');
    table.index(['target_user_id'], 'idx_admin_action_logs_target_user_id');
    table.index(['action'], 'idx_admin_action_logs_action');
    table.index(['created_at'], 'idx_admin_action_logs_created_at');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('admin_action_logs');
};
