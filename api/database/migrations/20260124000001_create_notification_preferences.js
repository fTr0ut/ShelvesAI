exports.up = async function (knex) {
    await knex.schema.createTable('notification_preferences', (table) => {
        table.uuid('user_id').primary().references('id').inTable('users').onDelete('CASCADE');
        table.boolean('push_enabled').notNullable().defaultTo(true);
        table.boolean('push_likes').notNullable().defaultTo(true);
        table.boolean('push_comments').notNullable().defaultTo(true);
        table.boolean('push_friend_requests').notNullable().defaultTo(true);
        table.boolean('push_friend_accepts').notNullable().defaultTo(true);
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('notification_preferences');
};
