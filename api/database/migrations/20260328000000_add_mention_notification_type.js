exports.up = async function (knex) {
    // Expand the notifications type CHECK constraint to include 'mention'
    await knex.raw(
        `ALTER TABLE notifications DROP CONSTRAINT notifications_type_check`
    );
    await knex.raw(
        `ALTER TABLE notifications
         ADD CONSTRAINT notifications_type_check
         CHECK (type IN ('like', 'comment', 'friend_request', 'friend_accept', 'mention'))`
    );

    // Add push_mentions preference column
    await knex.schema.alterTable('notification_preferences', (table) => {
        table.boolean('push_mentions').notNullable().defaultTo(true);
    });
};

exports.down = async function (knex) {
    // Remove push_mentions column
    await knex.schema.alterTable('notification_preferences', (table) => {
        table.dropColumn('push_mentions');
    });

    // Restore original type CHECK constraint
    await knex.raw(
        `ALTER TABLE notifications DROP CONSTRAINT notifications_type_check`
    );
    await knex.raw(
        `ALTER TABLE notifications
         ADD CONSTRAINT notifications_type_check
         CHECK (type IN ('like', 'comment', 'friend_request', 'friend_accept'))`
    );
};
