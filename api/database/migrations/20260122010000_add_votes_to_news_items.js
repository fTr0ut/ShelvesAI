/**
 * Migration: Add votes column to news_items
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('news_items', (table) => {
    table.integer('votes').notNullable().defaultTo(0);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('news_items', (table) => {
    table.dropColumn('votes');
  });
};
