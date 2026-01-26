/**
 * Migration: Add manual_id to event_aggregates for check-in events
 */
exports.up = async function (knex) {
    await knex.schema.alterTable('event_aggregates', (table) => {
        table.integer('manual_id').references('id').inTable('user_manuals').onDelete('SET NULL');
        table.index(['manual_id'], 'idx_event_aggregates_manual');
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable('event_aggregates', (table) => {
        table.dropIndex(['manual_id'], 'idx_event_aggregates_manual');
        table.dropColumn('manual_id');
    });
};
