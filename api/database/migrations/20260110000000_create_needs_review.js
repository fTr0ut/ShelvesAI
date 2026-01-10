exports.up = async function (knex) {
    await knex.schema.createTable('needs_review', (table) => {
        table.increments('id').primary();
        table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.integer('shelf_id').notNullable().references('id').inTable('shelves').onDelete('CASCADE');
        table.jsonb('raw_data').notNullable();
        table.decimal('confidence', 3, 2);
        table.string('status', 20).defaultTo('pending'); // pending, completed, dismissed
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());

        table.index(['user_id', 'status']);
        table.index(['shelf_id', 'status']);
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('needs_review');
};
