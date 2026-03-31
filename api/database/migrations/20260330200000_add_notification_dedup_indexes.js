exports.up = async function up(knex) {
  await knex.raw(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY user_id, entity_id, type
          ORDER BY created_at DESC, id DESC
        ) AS row_num
      FROM notifications
      WHERE deleted_at IS NULL
        AND type IN ('workflow_complete', 'workflow_failed')
    )
    UPDATE notifications n
    SET deleted_at = NOW()
    FROM ranked r
    WHERE n.id = r.id
      AND r.row_num > 1
  `);

  await knex.raw(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY user_id, actor_id, entity_id, type
          ORDER BY created_at DESC, id DESC
        ) AS row_num
      FROM notifications
      WHERE deleted_at IS NULL
        AND type = 'friend_accept'
    )
    UPDATE notifications n
    SET deleted_at = NOW()
    FROM ranked r
    WHERE n.id = r.id
      AND r.row_num > 1
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_workflow_dedup
      ON notifications(user_id, entity_id, type)
      WHERE deleted_at IS NULL
        AND type IN ('workflow_complete', 'workflow_failed')
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_friend_accept_dedup
      ON notifications(user_id, actor_id, entity_id, type)
      WHERE deleted_at IS NULL
        AND type = 'friend_accept'
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_notifications_friend_accept_dedup');
  await knex.raw('DROP INDEX IF EXISTS idx_notifications_workflow_dedup');
};
