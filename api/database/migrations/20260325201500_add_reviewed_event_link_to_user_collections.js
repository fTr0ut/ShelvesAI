exports.up = async function up(knex) {
  const hasReviewedEventLogId = await knex.schema.hasColumn('user_collections', 'reviewed_event_log_id');
  const hasReviewedEventPublishedAt = await knex.schema.hasColumn('user_collections', 'reviewed_event_published_at');
  const hasReviewedEventUpdatedAt = await knex.schema.hasColumn('user_collections', 'reviewed_event_updated_at');

  await knex.schema.alterTable('user_collections', (table) => {
    if (!hasReviewedEventLogId) {
      table.integer('reviewed_event_log_id').nullable();
    }
    if (!hasReviewedEventPublishedAt) {
      table.timestamp('reviewed_event_published_at', { useTz: true }).nullable();
    }
    if (!hasReviewedEventUpdatedAt) {
      table.timestamp('reviewed_event_updated_at', { useTz: true }).nullable();
    }
  });

  if (!hasReviewedEventLogId) {
    await knex.schema.alterTable('user_collections', (table) => {
      table
        .foreign('reviewed_event_log_id', 'user_collections_reviewed_event_log_id_fkey')
        .references('id')
        .inTable('event_logs')
        .onDelete('SET NULL');
    });
  }
};

exports.down = async function down(knex) {
  const hasReviewedEventLogId = await knex.schema.hasColumn('user_collections', 'reviewed_event_log_id');
  const hasReviewedEventPublishedAt = await knex.schema.hasColumn('user_collections', 'reviewed_event_published_at');
  const hasReviewedEventUpdatedAt = await knex.schema.hasColumn('user_collections', 'reviewed_event_updated_at');

  if (hasReviewedEventLogId) {
    await knex.schema.alterTable('user_collections', (table) => {
      table.dropForeign('reviewed_event_log_id', 'user_collections_reviewed_event_log_id_fkey');
    });
  }

  await knex.schema.alterTable('user_collections', (table) => {
    if (hasReviewedEventUpdatedAt) {
      table.dropColumn('reviewed_event_updated_at');
    }
    if (hasReviewedEventPublishedAt) {
      table.dropColumn('reviewed_event_published_at');
    }
    if (hasReviewedEventLogId) {
      table.dropColumn('reviewed_event_log_id');
    }
  });
};
