/**
 * Migration: Add collectable_id to news_items table
 *
 * Links news items directly to collectables for efficient FK-based lookups
 * instead of runtime joins by external_id.
 */

exports.up = async function (knex) {
    await knex.schema.alterTable('news_items', (table) => {
        table.integer('collectable_id')
            .references('id')
            .inTable('collectables')
            .onDelete('SET NULL');
    });

    await knex.raw(`
    CREATE INDEX idx_news_items_collectable_id ON news_items(collectable_id);
  `);

    // Backfill existing news_items with collectable_id where external_id matches
    await knex.raw(`
    UPDATE news_items ni
    SET collectable_id = c.id
    FROM collectables c
    WHERE ni.external_id = c.external_id
      AND ni.collectable_id IS NULL;
  `);
};

exports.down = async function (knex) {
    await knex.raw(`DROP INDEX IF EXISTS idx_news_items_collectable_id;`);
    await knex.schema.alterTable('news_items', (table) => {
        table.dropColumn('collectable_id');
    });
};
