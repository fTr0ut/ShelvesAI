exports.up = async function (knex) {
    const hasTable = await knex.schema.hasTable('vision_result_cache');
    if (hasTable) return;

    await knex.schema.createTable('vision_result_cache', (table) => {
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.integer('shelf_id').notNullable().references('id').inTable('shelves').onDelete('CASCADE');
        table.text('image_sha256').notNullable();
        table.jsonb('result_json').notNullable();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('expires_at', { useTz: true }).notNullable();
        table.primary(['user_id', 'shelf_id', 'image_sha256']);
        table.index(['expires_at'], 'idx_vision_result_cache_expires_at');
    });
};

exports.down = async function (knex) {
    const hasTable = await knex.schema.hasTable('vision_result_cache');
    if (!hasTable) return;
    await knex.schema.dropTable('vision_result_cache');
};
