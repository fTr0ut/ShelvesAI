/**
 * Migration: Add onboarding completion flag to users
 */

exports.up = async function (knex) {
    const hasColumn = await knex.schema.hasColumn('users', 'onboarding_completed');
    if (!hasColumn) {
        await knex.schema.alterTable('users', (table) => {
            table.boolean('onboarding_completed').notNullable().defaultTo(false);
        });
    }

    // Backfill existing users so they are not forced through onboarding
    await knex('users').update({ onboarding_completed: true });
};

exports.down = async function (knex) {
    const hasColumn = await knex.schema.hasColumn('users', 'onboarding_completed');
    if (hasColumn) {
        await knex.schema.alterTable('users', (table) => {
            table.dropColumn('onboarding_completed');
        });
    }
};
