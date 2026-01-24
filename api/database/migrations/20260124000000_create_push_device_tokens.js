exports.up = async function (knex) {
    await knex.schema.createTable('push_device_tokens', (table) => {
        table.increments('id').primary();
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.text('expo_push_token').notNullable();
        table.text('device_id');
        table.text('platform');
        table.boolean('is_active').notNullable().defaultTo(true);
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('last_used_at', { useTz: true });

        table.unique(['user_id', 'expo_push_token']);
        table.index(['user_id', 'is_active'], 'idx_push_tokens_user_active');
        table.index(['expo_push_token'], 'idx_push_tokens_token');
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('push_device_tokens');
};
