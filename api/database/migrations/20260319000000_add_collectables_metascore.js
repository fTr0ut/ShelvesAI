exports.up = function (knex) {
  return knex.schema.alterTable('collectables', (table) => {
    table.jsonb('metascore').nullable().defaultTo(null);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('collectables', (table) => {
    table.dropColumn('metascore');
  });
};
