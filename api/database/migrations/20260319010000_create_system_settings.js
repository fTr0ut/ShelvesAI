exports.up = function (knex) {
  return knex.schema.createTable('system_settings', (table) => {
    table.string('key', 255).primary();
    table.jsonb('value').notNullable();
    table.text('description').nullable();
    table.integer('updated_by').nullable().references('id').inTable('users');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('system_settings');
};
