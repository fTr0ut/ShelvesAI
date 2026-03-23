exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('vision_item_crops');
  if (exists) return;

  await knex.schema.createTable('vision_item_crops', (table) => {
    table.increments('id').primary();
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.integer('shelf_id').notNullable().references('id').inTable('shelves').onDelete('CASCADE');
    table.integer('scan_photo_id').notNullable().references('id').inTable('vision_scan_photos').onDelete('CASCADE');
    table.integer('region_id').notNullable().references('id').inTable('vision_item_regions').onDelete('CASCADE');
    table.text('storage_provider').notNullable();
    table.text('storage_key').notNullable();
    table.text('content_type').notNullable().defaultTo('image/jpeg');
    table.integer('size_bytes');
    table.integer('width');
    table.integer('height');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['region_id'], 'uq_vision_item_crops_region');
    table.index(['scan_photo_id'], 'idx_vision_item_crops_scan');
    table.index(['user_id', 'shelf_id'], 'idx_vision_item_crops_user_shelf');
  });
};

exports.down = async function (knex) {
  const exists = await knex.schema.hasTable('vision_item_crops');
  if (!exists) return;
  await knex.schema.dropTable('vision_item_crops');
};
