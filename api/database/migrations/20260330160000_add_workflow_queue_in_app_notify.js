exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('workflow_queue_jobs');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('workflow_queue_jobs', 'notify_in_app_on_complete');
  if (!hasColumn) {
    await knex.schema.alterTable('workflow_queue_jobs', (table) => {
      table.boolean('notify_in_app_on_complete').notNullable().defaultTo(false);
    });
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('workflow_queue_jobs');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('workflow_queue_jobs', 'notify_in_app_on_complete');
  if (hasColumn) {
    await knex.schema.alterTable('workflow_queue_jobs', (table) => {
      table.dropColumn('notify_in_app_on_complete');
    });
  }
};

