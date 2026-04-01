exports.up = async function up(knex) {
  const hasShelves = await knex.schema.hasTable('shelves');
  if (!hasShelves) return;

  const addColumnIfMissing = async (columnName, addColumnFn) => {
    const exists = await knex.schema.hasColumn('shelves', columnName);
    if (exists) return;
    await knex.schema.alterTable('shelves', addColumnFn);
  };

  await addColumnIfMissing('photo_storage_provider', (table) => {
    table.string('photo_storage_provider', 20).nullable();
  });
  await addColumnIfMissing('photo_storage_key', (table) => {
    table.text('photo_storage_key').nullable();
  });
  await addColumnIfMissing('photo_content_type', (table) => {
    table.string('photo_content_type', 100).nullable();
  });
  await addColumnIfMissing('photo_size_bytes', (table) => {
    table.integer('photo_size_bytes').nullable();
  });
  await addColumnIfMissing('photo_width', (table) => {
    table.integer('photo_width').nullable();
  });
  await addColumnIfMissing('photo_height', (table) => {
    table.integer('photo_height').nullable();
  });
  await addColumnIfMissing('photo_updated_at', (table) => {
    table.timestamp('photo_updated_at', { useTz: true }).nullable();
  });

  await knex.raw(`
    ALTER TABLE shelves
    DROP CONSTRAINT IF EXISTS shelves_photo_storage_check
  `);

  await knex.raw(`
    ALTER TABLE shelves
    ADD CONSTRAINT shelves_photo_storage_check
    CHECK (
      (
        photo_storage_provider IS NULL
        AND photo_storage_key IS NULL
        AND photo_content_type IS NULL
        AND photo_size_bytes IS NULL
        AND photo_width IS NULL
        AND photo_height IS NULL
        AND photo_updated_at IS NULL
      )
      OR (
        photo_storage_provider IN ('s3', 'local')
        AND photo_storage_key IS NOT NULL
        AND photo_content_type IS NOT NULL
        AND photo_size_bytes IS NOT NULL
        AND photo_size_bytes > 0
        AND photo_width IS NOT NULL
        AND photo_width > 0
        AND photo_height IS NOT NULL
        AND photo_height > 0
        AND photo_updated_at IS NOT NULL
      )
    )
  `);
};

exports.down = async function down(knex) {
  const hasShelves = await knex.schema.hasTable('shelves');
  if (!hasShelves) return;

  await knex.raw(`
    ALTER TABLE shelves
    DROP CONSTRAINT IF EXISTS shelves_photo_storage_check
  `);

  const dropColumnIfExists = async (columnName) => {
    const exists = await knex.schema.hasColumn('shelves', columnName);
    if (!exists) return;
    await knex.schema.alterTable('shelves', (table) => {
      table.dropColumn(columnName);
    });
  };

  await dropColumnIfExists('photo_updated_at');
  await dropColumnIfExists('photo_height');
  await dropColumnIfExists('photo_width');
  await dropColumnIfExists('photo_size_bytes');
  await dropColumnIfExists('photo_content_type');
  await dropColumnIfExists('photo_storage_key');
  await dropColumnIfExists('photo_storage_provider');
};
