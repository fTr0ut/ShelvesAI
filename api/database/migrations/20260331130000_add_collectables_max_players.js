exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('collectables');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('collectables', 'max_players');
  if (!hasColumn) {
    await knex.schema.alterTable('collectables', (table) => {
      table.integer('max_players').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('collectables');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('collectables', 'max_players');
  if (hasColumn) {
    await knex.schema.alterTable('collectables', (table) => {
      table.dropColumn('max_players');
    });
  }
};
