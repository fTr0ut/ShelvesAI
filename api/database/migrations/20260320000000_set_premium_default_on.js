/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.raw(`
    UPDATE users
    SET is_premium = TRUE
    WHERE is_premium IS DISTINCT FROM TRUE
  `);

  await knex.schema.alterTable('users', (table) => {
    table.boolean('is_premium').defaultTo(true).alter();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.boolean('is_premium').defaultTo(false).alter();
  });
};
