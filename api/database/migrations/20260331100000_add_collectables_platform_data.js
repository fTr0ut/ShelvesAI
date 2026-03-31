exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('collectables');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('collectables', 'platform_data');
  if (!hasColumn) {
    await knex.schema.alterTable('collectables', (table) => {
      table.jsonb('platform_data').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    });
  }

  await knex.raw(`
    UPDATE collectables
    SET platform_data = '[]'::jsonb
    WHERE platform_data IS NULL
  `);
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('collectables');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('collectables', 'platform_data');
  if (hasColumn) {
    await knex.schema.alterTable('collectables', (table) => {
      table.dropColumn('platform_data');
    });
  }
};
