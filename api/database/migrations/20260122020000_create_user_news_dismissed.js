/**
 * Migration: Create user_news_dismissed table
 *
 * Tracks which news items a user has dismissed ("don't show again").
 */

exports.up = async function (knex) {
  await knex.schema.createTable('user_news_dismissed', (table) => {
    table.increments('id').primary();
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.integer('news_item_id').notNullable().references('id').inTable('news_items').onDelete('CASCADE');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    // Prevent duplicate entries
    table.unique(['user_id', 'news_item_id']);
  });

  await knex.raw(`
    CREATE INDEX idx_user_news_dismissed_user ON user_news_dismissed(user_id);
  `);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_user_news_dismissed_user;`);
  await knex.schema.dropTableIfExists('user_news_dismissed');
};
