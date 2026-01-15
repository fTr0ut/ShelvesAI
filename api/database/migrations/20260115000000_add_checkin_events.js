/**
 * Migration: Add columns to event_aggregates for check-in events
 * 
 * Check-in events are standalone activity posts not tied to shelves.
 * They link a user to a collectable with a status (starting, continuing, completed).
 */
exports.up = async function (knex) {
    await knex.schema.alterTable('event_aggregates', (table) => {
        // Reference to the collectable being checked-in (for checkin.activity events)
        table.integer('collectable_id').references('id').inTable('collectables').onDelete('SET NULL');

        // Check-in status: starting, continuing, completed
        table.text('checkin_status');

        // Visibility: public or friends
        table.text('visibility').defaultTo('public');

        // Optional note/comment for the check-in
        table.text('note');

        // Index for efficient lookups by collectable
        table.index(['collectable_id'], 'idx_event_aggregates_collectable');
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable('event_aggregates', (table) => {
        table.dropIndex(['collectable_id'], 'idx_event_aggregates_collectable');
        table.dropColumn('note');
        table.dropColumn('visibility');
        table.dropColumn('checkin_status');
        table.dropColumn('collectable_id');
    });
};
