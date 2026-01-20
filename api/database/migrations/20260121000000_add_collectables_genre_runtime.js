exports.up = async function (knex) {
  const collectablesTable = 'collectables';
  const manualsTable = 'user_manuals';

  const hasCollectableGenre = await knex.schema.hasColumn(collectablesTable, 'genre');
  const hasCollectableRuntime = await knex.schema.hasColumn(collectablesTable, 'runtime');
  const hasManualGenre = await knex.schema.hasColumn(manualsTable, 'genre');

  if (!hasCollectableGenre) {
    await knex.schema.alterTable(collectablesTable, (table) => {
      table.specificType('genre', 'text[]').defaultTo('{}');
    });
  }

  if (!hasCollectableRuntime) {
    await knex.schema.alterTable(collectablesTable, (table) => {
      table.integer('runtime');
    });
  }

  if (!hasManualGenre) {
    await knex.schema.alterTable(manualsTable, (table) => {
      table.specificType('genre', 'text[]').defaultTo('{}');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('collectables', (table) => {
    table.dropColumn('runtime');
    table.dropColumn('genre');
  });

  await knex.schema.alterTable('user_manuals', (table) => {
    table.dropColumn('genre');
  });
};
