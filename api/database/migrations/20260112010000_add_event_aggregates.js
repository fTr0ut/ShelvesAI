exports.up = async function (knex) {
    await knex.schema.createTable('event_aggregates', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
        table.integer('shelf_id').references('id').inTable('shelves').onDelete('SET NULL');
        table.text('event_type').notNullable();
        table.timestamp('window_start_utc').notNullable();
        table.timestamp('window_end_utc').notNullable();
        table.integer('item_count').notNullable().defaultTo(0);
        table.jsonb('preview_payloads').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('last_activity_at').defaultTo(knex.fn.now());
        table.timestamp('closed_at');

        table.index(['user_id', 'shelf_id', 'event_type', 'window_end_utc'], 'idx_event_aggregates_scope_window');
        table.index(['last_activity_at'], 'idx_event_aggregates_last_activity');
    });

    await knex.schema.alterTable('event_logs', (table) => {
        table.uuid('aggregate_id').references('id').inTable('event_aggregates').onDelete('SET NULL');
        table.index(['aggregate_id'], 'idx_event_logs_aggregate');
    });

    await knex.schema.createTable('event_likes', (table) => {
        table.increments('id').primary();
        table.uuid('event_id').notNullable().references('id').inTable('event_aggregates').onDelete('CASCADE');
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.timestamp('created_at').defaultTo(knex.fn.now());

        table.unique(['event_id', 'user_id'], 'uniq_event_likes_event_user');
        table.index(['event_id'], 'idx_event_likes_event');
    });

    await knex.schema.createTable('event_comments', (table) => {
        table.increments('id').primary();
        table.uuid('event_id').notNullable().references('id').inTable('event_aggregates').onDelete('CASCADE');
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.text('content').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());

        table.index(['event_id'], 'idx_event_comments_event');
        table.index(['event_id', 'created_at'], 'idx_event_comments_created');
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('event_comments');
    await knex.schema.dropTableIfExists('event_likes');

    await knex.schema.alterTable('event_logs', (table) => {
        table.dropIndex(['aggregate_id'], 'idx_event_logs_aggregate');
        table.dropColumn('aggregate_id');
    });

    await knex.schema.dropTableIfExists('event_aggregates');
};
