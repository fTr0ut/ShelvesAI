exports.up = async function up(knex) {
  await knex.raw(
    `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check`
  );
  await knex.raw(
    `ALTER TABLE notifications
     ADD CONSTRAINT notifications_type_check
     CHECK (type IN (
       'like',
       'comment',
       'friend_request',
       'friend_accept',
       'mention',
       'workflow_complete',
       'workflow_failed'
     ))`
  );

  await knex.raw(
    `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_entity_type_check`
  );
  await knex.raw(
    `ALTER TABLE notifications
     ADD CONSTRAINT notifications_entity_type_check
     CHECK (entity_type IN ('event', 'friendship', 'workflow_job'))`
  );

  const hasColumn = await knex.schema.hasColumn('notification_preferences', 'push_workflow_jobs');
  if (!hasColumn) {
    await knex.schema.alterTable('notification_preferences', (table) => {
      table.boolean('push_workflow_jobs').notNullable().defaultTo(true);
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('notification_preferences', 'push_workflow_jobs');
  if (hasColumn) {
    await knex.schema.alterTable('notification_preferences', (table) => {
      table.dropColumn('push_workflow_jobs');
    });
  }

  await knex.raw(
    `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_entity_type_check`
  );
  await knex.raw(
    `ALTER TABLE notifications
     ADD CONSTRAINT notifications_entity_type_check
     CHECK (entity_type IN ('event', 'friendship'))`
  );

  await knex.raw(
    `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check`
  );
  await knex.raw(
    `ALTER TABLE notifications
     ADD CONSTRAINT notifications_type_check
     CHECK (type IN ('like', 'comment', 'friend_request', 'friend_accept', 'mention'))`
  );
};
