// Audit logs must be immutable — user deletion should never modify them.
// Drop the FK constraints on admin_action_logs so ON DELETE SET NULL
// no longer fires. The UUID values are retained permanently in the columns.
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE admin_action_logs DROP CONSTRAINT IF EXISTS admin_action_logs_target_user_id_foreign');
  await knex.raw('ALTER TABLE admin_action_logs DROP CONSTRAINT IF EXISTS admin_action_logs_admin_id_foreign');
};

exports.down = async function (knex) {
  await knex.schema.alterTable('admin_action_logs', (table) => {
    table.uuid('admin_id').references('id').inTable('users').onDelete('SET NULL').alter();
    table.uuid('target_user_id').references('id').inTable('users').onDelete('SET NULL').alter();
  });
};
