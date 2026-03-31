exports.up = async function up(knex) {
  const hasUserCollections = await knex.schema.hasTable('user_collections');
  if (!hasUserCollections) return;

  const hasTable = await knex.schema.hasTable('user_collection_platforms');
  if (!hasTable) {
    await knex.schema.createTable('user_collection_platforms', (table) => {
      table.increments('id').primary();
      table
        .integer('collection_item_id')
        .notNullable()
        .references('id')
        .inTable('user_collections')
        .onDelete('CASCADE');
      table.text('platform_name').notNullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_collection_platforms_unique_item_name
    ON user_collection_platforms (collection_item_id, lower(platform_name))
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_user_collection_platforms_platform_name_lower
    ON user_collection_platforms (lower(platform_name))
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_user_collection_platforms_collection_item
    ON user_collection_platforms (collection_item_id)
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_user_collection_platforms_collection_item');
  await knex.raw('DROP INDEX IF EXISTS idx_user_collection_platforms_platform_name_lower');
  await knex.raw('DROP INDEX IF EXISTS idx_user_collection_platforms_unique_item_name');

  const hasTable = await knex.schema.hasTable('user_collection_platforms');
  if (hasTable) {
    await knex.schema.dropTable('user_collection_platforms');
  }
};
