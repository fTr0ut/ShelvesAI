exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('vision_item_regions');
  if (!hasTable) return;
  const hasColumn = await knex.schema.hasColumn('vision_item_regions', 'quad_2d');
  if (hasColumn) return;
  await knex.schema.alterTable('vision_item_regions', (table) => {
    table.jsonb('quad_2d').nullable().defaultTo(null);
  });
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('vision_item_regions');
  if (!hasTable) return;
  const hasColumn = await knex.schema.hasColumn('vision_item_regions', 'quad_2d');
  if (!hasColumn) return;
  await knex.schema.alterTable('vision_item_regions', (table) => {
    table.dropColumn('quad_2d');
  });
};
