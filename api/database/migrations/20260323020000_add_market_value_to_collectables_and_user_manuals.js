exports.up = async function (knex) {
  const hasCollectablesMarketValue = await knex.schema.hasColumn('collectables', 'market_value');
  const hasCollectablesMarketValueSources = await knex.schema.hasColumn('collectables', 'market_value_sources');
  const hasUserManualsMarketValue = await knex.schema.hasColumn('user_manuals', 'market_value');
  const hasUserManualsMarketValueSources = await knex.schema.hasColumn('user_manuals', 'market_value_sources');

  if (!hasCollectablesMarketValue) {
    await knex.schema.alterTable('collectables', (table) => {
      table.text('market_value').nullable();
    });
  }

  if (!hasCollectablesMarketValueSources) {
    await knex.schema.alterTable('collectables', (table) => {
      table.jsonb('market_value_sources').nullable().defaultTo(knex.raw(`'[]'::jsonb`));
    });
  }

  if (!hasUserManualsMarketValue) {
    await knex.schema.alterTable('user_manuals', (table) => {
      table.text('market_value').nullable();
    });
  }

  if (!hasUserManualsMarketValueSources) {
    await knex.schema.alterTable('user_manuals', (table) => {
      table.jsonb('market_value_sources').nullable().defaultTo(knex.raw(`'[]'::jsonb`));
    });
  }
};

exports.down = async function (knex) {
  const hasCollectablesMarketValue = await knex.schema.hasColumn('collectables', 'market_value');
  const hasCollectablesMarketValueSources = await knex.schema.hasColumn('collectables', 'market_value_sources');
  const hasUserManualsMarketValue = await knex.schema.hasColumn('user_manuals', 'market_value');
  const hasUserManualsMarketValueSources = await knex.schema.hasColumn('user_manuals', 'market_value_sources');

  if (hasCollectablesMarketValue) {
    await knex.schema.alterTable('collectables', (table) => {
      table.dropColumn('market_value');
    });
  }

  if (hasCollectablesMarketValueSources) {
    await knex.schema.alterTable('collectables', (table) => {
      table.dropColumn('market_value_sources');
    });
  }

  if (hasUserManualsMarketValue) {
    await knex.schema.alterTable('user_manuals', (table) => {
      table.dropColumn('market_value');
    });
  }

  if (hasUserManualsMarketValueSources) {
    await knex.schema.alterTable('user_manuals', (table) => {
      table.dropColumn('market_value_sources');
    });
  }
};
