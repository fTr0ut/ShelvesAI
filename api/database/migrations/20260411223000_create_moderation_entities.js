exports.up = async function (knex) {
  await knex.schema.createTable('moderation_entities', (table) => {
    table.increments('id').primary();
    table.text('content_type').notNullable();
    table.text('content_id').notNullable();
    table.text('status').notNullable().defaultTo('active');
    table.text('last_action').nullable();
    table.text('last_actor_type').notNullable().defaultTo('human');
    table.uuid('last_admin_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    table.text('rule_code').nullable();
    table.text('action_reason').nullable();
    table.decimal('confidence', 5, 4).nullable();
    table.jsonb('evidence_snapshot').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.timestamp('alerts_sent_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['content_type', 'content_id'], 'uq_moderation_entities_content');
    table.index(['status'], 'idx_moderation_entities_status');
    table.index(['updated_at'], 'idx_moderation_entities_updated_at');
  });

  await knex.raw(`
    ALTER TABLE moderation_entities
    ADD CONSTRAINT moderation_entities_status_check
    CHECK (status IN ('active', 'flagged', 'hidden', 'cleared', 'deleted'))
  `);

  await knex.raw(`
    ALTER TABLE moderation_entities
    ADD CONSTRAINT moderation_entities_last_actor_type_check
    CHECK (last_actor_type IN ('human', 'bot'))
  `);

  await knex('system_settings')
    .insert({
      key: 'moderation_bot_config',
      value: JSON.stringify({
        mode: 'recommend_only',
        alertHumanAdmins: true,
      }),
      description: 'Controls moderation bot execution mode and admin alert behavior',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    })
    .onConflict('key')
    .ignore();
};

exports.down = async function (knex) {
  await knex('system_settings').where({ key: 'moderation_bot_config' }).del();
  await knex.schema.dropTableIfExists('moderation_entities');
};
