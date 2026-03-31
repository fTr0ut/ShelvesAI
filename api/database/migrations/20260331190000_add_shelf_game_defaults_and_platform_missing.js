exports.up = async function up(knex) {
  const hasShelves = await knex.schema.hasTable('shelves');
  if (hasShelves) {
    const hasGameDefaults = await knex.schema.hasColumn('shelves', 'game_defaults');
    if (!hasGameDefaults) {
      await knex.schema.alterTable('shelves', (table) => {
        table.jsonb('game_defaults').nullable();
      });
    }
  }

  const hasUserCollections = await knex.schema.hasTable('user_collections');
  if (hasUserCollections) {
    const hasPlatformMissing = await knex.schema.hasColumn('user_collections', 'platform_missing');
    if (!hasPlatformMissing) {
      await knex.schema.alterTable('user_collections', (table) => {
        table.boolean('platform_missing').notNullable().defaultTo(false);
      });
    }
  }
};

exports.down = async function down(knex) {
  const hasUserCollections = await knex.schema.hasTable('user_collections');
  if (hasUserCollections) {
    const hasPlatformMissing = await knex.schema.hasColumn('user_collections', 'platform_missing');
    if (hasPlatformMissing) {
      await knex.schema.alterTable('user_collections', (table) => {
        table.dropColumn('platform_missing');
      });
    }
  }

  const hasShelves = await knex.schema.hasTable('shelves');
  if (hasShelves) {
    const hasGameDefaults = await knex.schema.hasColumn('shelves', 'game_defaults');
    if (hasGameDefaults) {
      await knex.schema.alterTable('shelves', (table) => {
        table.dropColumn('game_defaults');
      });
    }
  }
};
