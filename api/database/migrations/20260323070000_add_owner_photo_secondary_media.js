exports.up = async function (knex) {
  const hasUserTable = await knex.schema.hasTable('users');
  if (hasUserTable) {
    const hasShowPersonalPhotos = await knex.schema.hasColumn('users', 'show_personal_photos');
    if (!hasShowPersonalPhotos) {
      await knex.schema.alterTable('users', (table) => {
        table.boolean('show_personal_photos').notNullable().defaultTo(false);
      });
    }
  }

  const hasCollections = await knex.schema.hasTable('user_collections');
  if (!hasCollections) return;

  const hasOwnerPhotoSource = await knex.schema.hasColumn('user_collections', 'owner_photo_source');
  if (!hasOwnerPhotoSource) {
    await knex.schema.alterTable('user_collections', (table) => {
      table.string('owner_photo_source', 20).nullable();
      table.integer('owner_photo_crop_id').nullable();
      table.string('owner_photo_storage_provider', 20).nullable();
      table.text('owner_photo_storage_key').nullable();
      table.string('owner_photo_content_type', 100).nullable();
      table.integer('owner_photo_size_bytes').nullable();
      table.integer('owner_photo_width').nullable();
      table.integer('owner_photo_height').nullable();
      table.boolean('owner_photo_visible').notNullable().defaultTo(false);
      table.timestamp('owner_photo_updated_at', { useTz: true }).nullable();
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_user_collections_owner_photo_crop
    ON user_collections(owner_photo_crop_id)
    WHERE owner_photo_crop_id IS NOT NULL
  `);

  const hasVisionItemCrops = await knex.schema.hasTable('vision_item_crops');
  if (hasVisionItemCrops) {
    await knex.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'user_collections'
            AND constraint_name = 'user_collections_owner_photo_crop_id_fkey'
        ) THEN
          ALTER TABLE user_collections
            ADD CONSTRAINT user_collections_owner_photo_crop_id_fkey
            FOREIGN KEY (owner_photo_crop_id)
            REFERENCES vision_item_crops(id)
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  await knex.raw(`
    ALTER TABLE user_collections
    DROP CONSTRAINT IF EXISTS owner_photo_source_check
  `);
  await knex.raw(`
    ALTER TABLE user_collections
    ADD CONSTRAINT owner_photo_source_check
    CHECK (owner_photo_source IS NULL OR owner_photo_source IN ('vision_crop', 'upload'))
  `);

  await knex.raw(`
    ALTER TABLE user_collections
    DROP CONSTRAINT IF EXISTS owner_photo_reference_check
  `);
  await knex.raw(`
    ALTER TABLE user_collections
    ADD CONSTRAINT owner_photo_reference_check
    CHECK (
      (owner_photo_source IS NULL AND owner_photo_crop_id IS NULL AND owner_photo_storage_key IS NULL AND owner_photo_storage_provider IS NULL)
      OR (owner_photo_source = 'vision_crop' AND owner_photo_crop_id IS NOT NULL)
      OR (owner_photo_source = 'upload' AND owner_photo_storage_key IS NOT NULL AND owner_photo_storage_provider IS NOT NULL)
    )
  `);
};

exports.down = async function (knex) {
  const hasCollections = await knex.schema.hasTable('user_collections');
  if (hasCollections) {
    await knex.raw(`
      ALTER TABLE user_collections
      DROP CONSTRAINT IF EXISTS owner_photo_reference_check
    `);
    await knex.raw(`
      ALTER TABLE user_collections
      DROP CONSTRAINT IF EXISTS owner_photo_source_check
    `);
    await knex.raw(`
      ALTER TABLE user_collections
      DROP CONSTRAINT IF EXISTS user_collections_owner_photo_crop_id_fkey
    `);
    await knex.raw('DROP INDEX IF EXISTS idx_user_collections_owner_photo_crop');

    const hasOwnerPhotoSource = await knex.schema.hasColumn('user_collections', 'owner_photo_source');
    if (hasOwnerPhotoSource) {
      await knex.schema.alterTable('user_collections', (table) => {
        table.dropColumn('owner_photo_updated_at');
        table.dropColumn('owner_photo_visible');
        table.dropColumn('owner_photo_height');
        table.dropColumn('owner_photo_width');
        table.dropColumn('owner_photo_size_bytes');
        table.dropColumn('owner_photo_content_type');
        table.dropColumn('owner_photo_storage_key');
        table.dropColumn('owner_photo_storage_provider');
        table.dropColumn('owner_photo_crop_id');
        table.dropColumn('owner_photo_source');
      });
    }
  }

  const hasUserTable = await knex.schema.hasTable('users');
  if (hasUserTable) {
    const hasShowPersonalPhotos = await knex.schema.hasColumn('users', 'show_personal_photos');
    if (hasShowPersonalPhotos) {
      await knex.schema.alterTable('users', (table) => {
        table.dropColumn('show_personal_photos');
      });
    }
  }
};
