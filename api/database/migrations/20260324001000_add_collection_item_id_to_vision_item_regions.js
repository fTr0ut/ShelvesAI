exports.up = async function (knex) {
  const tableName = 'vision_item_regions';
  const hasTable = await knex.schema.hasTable(tableName);
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn(tableName, 'collection_item_id');
  if (!hasColumn) {
    await knex.schema.alterTable(tableName, (table) => {
      table
        .integer('collection_item_id')
        .references('id')
        .inTable('user_collections')
        .onDelete('SET NULL');
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_vision_item_regions_collection_item
      ON vision_item_regions(collection_item_id)
  `);
};

exports.down = async function (knex) {
  const tableName = 'vision_item_regions';
  const hasTable = await knex.schema.hasTable(tableName);
  if (!hasTable) return;

  await knex.raw('DROP INDEX IF EXISTS idx_vision_item_regions_collection_item');

  const hasColumn = await knex.schema.hasColumn(tableName, 'collection_item_id');
  if (hasColumn) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('collection_item_id');
    });
  }
};
