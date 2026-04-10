exports.up = async function up(knex) {
  const tableName = 'user_collections';
  const checks = await Promise.all([
    knex.schema.hasColumn(tableName, 'series'),
    knex.schema.hasColumn(tableName, 'edition'),
    knex.schema.hasColumn(tableName, 'special_markings'),
    knex.schema.hasColumn(tableName, 'age_statement'),
    knex.schema.hasColumn(tableName, 'label_color'),
    knex.schema.hasColumn(tableName, 'regional_item'),
    knex.schema.hasColumn(tableName, 'barcode'),
    knex.schema.hasColumn(tableName, 'item_specific_text'),
  ]);

  await knex.schema.alterTable(tableName, (table) => {
    if (!checks[0]) table.text('series').nullable();
    if (!checks[1]) table.text('edition').nullable();
    if (!checks[2]) table.text('special_markings').nullable();
    if (!checks[3]) table.text('age_statement').nullable();
    if (!checks[4]) table.text('label_color').nullable();
    if (!checks[5]) table.text('regional_item').nullable();
    if (!checks[6]) table.text('barcode').nullable();
    if (!checks[7]) table.text('item_specific_text').nullable();
  });
};

exports.down = async function down(knex) {
  const tableName = 'user_collections';
  const checks = await Promise.all([
    knex.schema.hasColumn(tableName, 'item_specific_text'),
    knex.schema.hasColumn(tableName, 'barcode'),
    knex.schema.hasColumn(tableName, 'regional_item'),
    knex.schema.hasColumn(tableName, 'label_color'),
    knex.schema.hasColumn(tableName, 'age_statement'),
    knex.schema.hasColumn(tableName, 'special_markings'),
    knex.schema.hasColumn(tableName, 'edition'),
    knex.schema.hasColumn(tableName, 'series'),
  ]);

  await knex.schema.alterTable(tableName, (table) => {
    if (checks[0]) table.dropColumn('item_specific_text');
    if (checks[1]) table.dropColumn('barcode');
    if (checks[2]) table.dropColumn('regional_item');
    if (checks[3]) table.dropColumn('label_color');
    if (checks[4]) table.dropColumn('age_statement');
    if (checks[5]) table.dropColumn('special_markings');
    if (checks[6]) table.dropColumn('edition');
    if (checks[7]) table.dropColumn('series');
  });
};
