exports.up = async function (knex) {
    await knex.schema.createTable('broadcast_logs', (table) => {
        table.increments('id').primary();
        table.string('title', 255).notNullable();
        table.text('body').notNullable();
        table.jsonb('metadata').nullable();
        table.timestamp('sent_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.integer('total_tokens').notNullable().defaultTo(0);
        table.integer('success_count').notNullable().defaultTo(0);
        table.integer('error_count').notNullable().defaultTo(0);
        table.string('sent_by_admin_id', 255).nullable();
        table.enu('status', ['pending', 'running', 'completed', 'cancelled'])
            .notNullable()
            .defaultTo('pending');
        table.boolean('is_suppressed').notNullable().defaultTo(false);
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('broadcast_logs');
};
