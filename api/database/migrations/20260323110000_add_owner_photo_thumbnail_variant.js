exports.up = async function up(knex) {
  const hasCollections = await knex.schema.hasTable('user_collections');
  if (!hasCollections) return;

  const addColumnIfMissing = async (columnName, addColumnFn) => {
    const exists = await knex.schema.hasColumn('user_collections', columnName);
    if (exists) return;
    await knex.schema.alterTable('user_collections', addColumnFn);
  };

  await addColumnIfMissing('owner_photo_thumb_storage_provider', (table) => {
    table.string('owner_photo_thumb_storage_provider', 20).nullable();
  });
  await addColumnIfMissing('owner_photo_thumb_storage_key', (table) => {
    table.text('owner_photo_thumb_storage_key').nullable();
  });
  await addColumnIfMissing('owner_photo_thumb_content_type', (table) => {
    table.string('owner_photo_thumb_content_type', 100).nullable();
  });
  await addColumnIfMissing('owner_photo_thumb_size_bytes', (table) => {
    table.integer('owner_photo_thumb_size_bytes').nullable();
  });
  await addColumnIfMissing('owner_photo_thumb_width', (table) => {
    table.integer('owner_photo_thumb_width').nullable();
  });
  await addColumnIfMissing('owner_photo_thumb_height', (table) => {
    table.integer('owner_photo_thumb_height').nullable();
  });
  await addColumnIfMissing('owner_photo_thumb_box', (table) => {
    table.jsonb('owner_photo_thumb_box').nullable();
  });
  await addColumnIfMissing('owner_photo_thumb_updated_at', (table) => {
    table.timestamp('owner_photo_thumb_updated_at', { useTz: true }).nullable();
  });

  await knex.raw(`
    ALTER TABLE user_collections
    DROP CONSTRAINT IF EXISTS owner_photo_thumb_box_check
  `);

  await knex.raw(`
    ALTER TABLE user_collections
    ADD CONSTRAINT owner_photo_thumb_box_check
    CHECK (
      owner_photo_thumb_box IS NULL
      OR (
        jsonb_typeof(owner_photo_thumb_box) = 'object'
        AND jsonb_exists(owner_photo_thumb_box, 'x')
        AND jsonb_exists(owner_photo_thumb_box, 'y')
        AND jsonb_exists(owner_photo_thumb_box, 'width')
        AND jsonb_exists(owner_photo_thumb_box, 'height')
        AND jsonb_typeof(owner_photo_thumb_box->'x') = 'number'
        AND jsonb_typeof(owner_photo_thumb_box->'y') = 'number'
        AND jsonb_typeof(owner_photo_thumb_box->'width') = 'number'
        AND jsonb_typeof(owner_photo_thumb_box->'height') = 'number'
        AND (owner_photo_thumb_box->>'x')::double precision >= 0
        AND (owner_photo_thumb_box->>'x')::double precision <= 1
        AND (owner_photo_thumb_box->>'y')::double precision >= 0
        AND (owner_photo_thumb_box->>'y')::double precision <= 1
        AND (owner_photo_thumb_box->>'width')::double precision > 0
        AND (owner_photo_thumb_box->>'width')::double precision <= 1
        AND (owner_photo_thumb_box->>'height')::double precision > 0
        AND (owner_photo_thumb_box->>'height')::double precision <= 1
        AND (
          (owner_photo_thumb_box->>'x')::double precision
          + (owner_photo_thumb_box->>'width')::double precision
        ) <= 1.000001
        AND (
          (owner_photo_thumb_box->>'y')::double precision
          + (owner_photo_thumb_box->>'height')::double precision
        ) <= 1.000001
      )
    )
  `);
};

exports.down = async function down(knex) {
  const hasCollections = await knex.schema.hasTable('user_collections');
  if (!hasCollections) return;

  await knex.raw(`
    ALTER TABLE user_collections
    DROP CONSTRAINT IF EXISTS owner_photo_thumb_box_check
  `);

  const dropColumnIfExists = async (columnName) => {
    const exists = await knex.schema.hasColumn('user_collections', columnName);
    if (!exists) return;
    await knex.schema.alterTable('user_collections', (table) => {
      table.dropColumn(columnName);
    });
  };

  await dropColumnIfExists('owner_photo_thumb_updated_at');
  await dropColumnIfExists('owner_photo_thumb_box');
  await dropColumnIfExists('owner_photo_thumb_height');
  await dropColumnIfExists('owner_photo_thumb_width');
  await dropColumnIfExists('owner_photo_thumb_size_bytes');
  await dropColumnIfExists('owner_photo_thumb_content_type');
  await dropColumnIfExists('owner_photo_thumb_storage_key');
  await dropColumnIfExists('owner_photo_thumb_storage_provider');
};
