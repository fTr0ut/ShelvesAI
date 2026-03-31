exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('collectables');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('collectables', 'igdb_payload');
  if (!hasColumn) {
    await knex.schema.alterTable('collectables', (table) => {
      table.jsonb('igdb_payload').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('collectables');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('collectables', 'igdb_payload');
  if (hasColumn) {
    await knex.schema.alterTable('collectables', (table) => {
      table.dropColumn('igdb_payload');
    });
  }
};

