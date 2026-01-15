exports.up = async function (knex) {
    await knex.schema.createTable('notifications', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.uuid('actor_id').references('id').inTable('users').onDelete('SET NULL');
        table.text('type').notNullable();
        table.text('entity_id').notNullable();
        table.text('entity_type').notNullable();
        table.jsonb('metadata').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
        table.boolean('is_read').notNullable().defaultTo(false);
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('deleted_at', { useTz: true });

        table.index(['user_id', 'is_read', 'created_at'], 'idx_notifications_user_unread');
        table.index(['user_id', 'created_at'], 'idx_notifications_user_created');
    });

    await knex.raw(
        `ALTER TABLE notifications
         ADD CONSTRAINT notifications_type_check
         CHECK (type IN ('like', 'comment', 'friend_request', 'friend_accept'))`
    );

    await knex.raw(
        `ALTER TABLE notifications
         ADD CONSTRAINT notifications_entity_type_check
         CHECK (entity_type IN ('event', 'friendship'))`
    );

    await knex.raw(
        `CREATE UNIQUE INDEX idx_notifications_like_active
         ON notifications(user_id, actor_id, entity_id, type)
         WHERE type = 'like' AND deleted_at IS NULL`
    );

    await knex.raw(
        `CREATE UNIQUE INDEX idx_notifications_friend_request_dedup
         ON notifications(user_id, actor_id, entity_id, type)
         WHERE type = 'friend_request' AND deleted_at IS NULL`
    );
};

exports.down = async function (knex) {
    await knex.raw('DROP INDEX IF EXISTS idx_notifications_friend_request_dedup');
    await knex.raw('DROP INDEX IF EXISTS idx_notifications_like_active');
    await knex.raw('ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_entity_type_check');
    await knex.raw('ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check');
    await knex.schema.dropTableIfExists('notifications');
};
