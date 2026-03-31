exports.up = async function (knex) {
  const hasFormat = await knex.schema.hasColumn('collectables', 'format');
  if (hasFormat) return;
  await knex.schema.alterTable('collectables', (table) => {
    table.string('format', 20);
  });
};

exports.down = async function (knex) {
  const hasFormat = await knex.schema.hasColumn('collectables', 'format');
  if (!hasFormat) return;
  await knex.schema.alterTable('collectables', (table) => {
    table.dropColumn('format');
  });
};
