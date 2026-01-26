/**
 * Creates the user_vision_quota table for tracking Vision OCR usage
 * with a rolling 30-day period per user.
 */
exports.up = async function (knex) {
    await knex.schema.createTable('user_vision_quota', (table) => {
        table.uuid('user_id').primary().references('id').inTable('users').onDelete('CASCADE');
        table.integer('scans_used').notNullable().defaultTo(0);
        table.timestamp('period_start', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('user_vision_quota');
};
