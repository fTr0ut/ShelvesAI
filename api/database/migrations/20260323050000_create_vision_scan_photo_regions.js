exports.up = async function (knex) {
  const hasScanPhotos = await knex.schema.hasTable('vision_scan_photos');
  if (!hasScanPhotos) {
    await knex.schema.createTable('vision_scan_photos', (table) => {
      table.increments('id').primary();
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.integer('shelf_id').notNullable().references('id').inTable('shelves').onDelete('CASCADE');
      table.text('image_sha256').notNullable();
      table.text('storage_provider').notNullable();
      table.text('storage_key').notNullable();
      table.text('content_type').notNullable().defaultTo('image/jpeg');
      table.integer('size_bytes');
      table.integer('width');
      table.integer('height');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.unique(['user_id', 'shelf_id', 'image_sha256'], 'uq_vision_scan_photos_user_shelf_hash');
      table.index(['user_id', 'shelf_id'], 'idx_vision_scan_photos_user_shelf');
    });
  }

  const hasItemRegions = await knex.schema.hasTable('vision_item_regions');
  if (!hasItemRegions) {
    await knex.schema.createTable('vision_item_regions', (table) => {
      table.increments('id').primary();
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.integer('shelf_id').notNullable().references('id').inTable('shelves').onDelete('CASCADE');
      table.integer('scan_photo_id').notNullable().references('id').inTable('vision_scan_photos').onDelete('CASCADE');
      table.integer('extraction_index').notNullable();
      table.text('title');
      table.text('primary_creator');
      table.jsonb('box_2d').notNullable();
      table.decimal('confidence', 4, 3);
      table.integer('collectable_id').references('id').inTable('collectables').onDelete('SET NULL');
      table.integer('manual_id').references('id').inTable('user_manuals').onDelete('SET NULL');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.unique(['scan_photo_id', 'extraction_index'], 'uq_vision_item_regions_scan_index');
      table.index(['scan_photo_id'], 'idx_vision_item_regions_scan');
      table.index(['collectable_id'], 'idx_vision_item_regions_collectable');
      table.index(['manual_id'], 'idx_vision_item_regions_manual');
      table.index(['user_id', 'shelf_id'], 'idx_vision_item_regions_user_shelf');
    });
  }
};

exports.down = async function (knex) {
  const hasItemRegions = await knex.schema.hasTable('vision_item_regions');
  if (hasItemRegions) {
    await knex.schema.dropTable('vision_item_regions');
  }

  const hasScanPhotos = await knex.schema.hasTable('vision_scan_photos');
  if (hasScanPhotos) {
    await knex.schema.dropTable('vision_scan_photos');
  }
};

