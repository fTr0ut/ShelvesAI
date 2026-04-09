/**
 * Adds token-based quota tracking columns to user_vision_quota
 * and an unlimited_vision_tokens flag to users (admin-only).
 */
exports.up = async function (knex) {
    await knex.schema.alterTable('user_vision_quota', (table) => {
        table.bigInteger('tokens_used').notNullable().defaultTo(0);
        table.bigInteger('output_tokens_used').notNullable().defaultTo(0);
    });

    await knex.schema.alterTable('users', (table) => {
        table.boolean('unlimited_vision_tokens').notNullable().defaultTo(false);
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable('user_vision_quota', (table) => {
        table.dropColumn('tokens_used');
        table.dropColumn('output_tokens_used');
    });

    await knex.schema.alterTable('users', (table) => {
        table.dropColumn('unlimited_vision_tokens');
    });
};
