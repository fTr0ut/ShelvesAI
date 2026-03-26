exports.up = async function (knex) {
  const tableName = 'item_replacement_traces';
  const exists = await knex.schema.hasTable(tableName);
  if (exists) return;

  await knex.schema.createTable(tableName, (table) => {
    table.bigIncrements('id').primary();
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.integer('shelf_id').notNullable().references('id').inTable('shelves').onDelete('CASCADE');

    table.integer('source_item_id').notNullable();
    table.integer('source_collectable_id').nullable().references('id').inTable('collectables').onDelete('SET NULL');
    table.integer('source_manual_id').nullable().references('id').inTable('user_manuals').onDelete('SET NULL');

    table.text('trigger_source').notNullable();
    table.text('status').notNullable().defaultTo('initiated');

    table.integer('target_item_id').nullable();
    table.integer('target_collectable_id').nullable().references('id').inTable('collectables').onDelete('SET NULL');
    table.integer('target_manual_id').nullable().references('id').inTable('user_manuals').onDelete('SET NULL');

    table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.timestamp('initiated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true }).nullable();

    table.index(['user_id'], 'idx_item_replacement_traces_user');
    table.index(['shelf_id'], 'idx_item_replacement_traces_shelf');
    table.index(['source_item_id'], 'idx_item_replacement_traces_source_item');
    table.index(['source_collectable_id'], 'idx_item_replacement_traces_source_collectable');
    table.index(['target_collectable_id'], 'idx_item_replacement_traces_target_collectable');
    table.index(['status'], 'idx_item_replacement_traces_status');
    table.index(['initiated_at'], 'idx_item_replacement_traces_initiated_at');
  });

  await knex.raw(`
    ALTER TABLE item_replacement_traces
    ADD CONSTRAINT item_replacement_traces_trigger_source_check
    CHECK (trigger_source IN ('collectable_detail', 'shelf_delete_modal'))
  `);

  await knex.raw(`
    ALTER TABLE item_replacement_traces
    ADD CONSTRAINT item_replacement_traces_status_check
    CHECK (status IN ('initiated', 'completed', 'failed'))
  `);

  await knex.raw(`
    ALTER TABLE item_replacement_traces
    ADD CONSTRAINT item_replacement_traces_source_reference_check
    CHECK (
      (source_collectable_id IS NOT NULL AND source_manual_id IS NULL)
      OR (source_collectable_id IS NULL AND source_manual_id IS NOT NULL)
    )
  `);

  await knex.raw(`
    ALTER TABLE item_replacement_traces
    ADD CONSTRAINT item_replacement_traces_completed_target_check
    CHECK (
      status <> 'completed'
      OR (
        completed_at IS NOT NULL
        AND target_item_id IS NOT NULL
        AND (
          (target_collectable_id IS NOT NULL AND target_manual_id IS NULL)
          OR (target_collectable_id IS NULL AND target_manual_id IS NOT NULL)
        )
      )
    )
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('item_replacement_traces');
};
