/**
 * RLS Tier 3: Complex Access Patterns
 * Tables with non-standard access requirements
 */

exports.up = async function (knex) {
  // ============================================
  // FRIENDSHIPS - both parties can access
  // ============================================
  await knex.raw('ALTER TABLE friendships ENABLE ROW LEVEL SECURITY');

  // Participants: full access
  await knex.raw(`
    CREATE POLICY friendships_participant ON friendships
      FOR ALL
      USING (requester_id = current_app_user_id() OR addressee_id = current_app_user_id())
      WITH CHECK (requester_id = current_app_user_id() OR addressee_id = current_app_user_id())
  `);

  // Admin: full access
  await knex.raw(`
    CREATE POLICY friendships_admin ON friendships
      FOR ALL
      USING (is_current_user_admin())
      WITH CHECK (is_current_user_admin())
  `);

  // ============================================
  // NOTIFICATIONS - recipient only
  // ============================================
  await knex.raw('ALTER TABLE notifications ENABLE ROW LEVEL SECURITY');

  // Recipient: full access
  await knex.raw(`
    CREATE POLICY notifications_recipient ON notifications
      FOR ALL
      USING (user_id = current_app_user_id())
      WITH CHECK (user_id = current_app_user_id())
  `);

  // Admin: full access
  await knex.raw(`
    CREATE POLICY notifications_admin ON notifications
      FOR ALL
      USING (is_current_user_admin())
      WITH CHECK (is_current_user_admin())
  `);

  // ============================================
  // ADMIN_ACTION_LOGS - admins only
  // ============================================
  const hasAdminLogs = await knex.schema.hasTable('admin_action_logs');
  if (hasAdminLogs) {
    await knex.raw('ALTER TABLE admin_action_logs ENABLE ROW LEVEL SECURITY');

    await knex.raw(`
      CREATE POLICY admin_logs_admin ON admin_action_logs
        FOR ALL
        USING (is_current_user_admin())
        WITH CHECK (is_current_user_admin())
    `);
  }
};

exports.down = async function (knex) {
  // admin_action_logs
  const hasAdminLogs = await knex.schema.hasTable('admin_action_logs');
  if (hasAdminLogs) {
    await knex.raw('DROP POLICY IF EXISTS admin_logs_admin ON admin_action_logs');
    await knex.raw('ALTER TABLE admin_action_logs DISABLE ROW LEVEL SECURITY');
  }

  // notifications
  await knex.raw('DROP POLICY IF EXISTS notifications_admin ON notifications');
  await knex.raw('DROP POLICY IF EXISTS notifications_recipient ON notifications');
  await knex.raw('ALTER TABLE notifications DISABLE ROW LEVEL SECURITY');

  // friendships
  await knex.raw('DROP POLICY IF EXISTS friendships_admin ON friendships');
  await knex.raw('DROP POLICY IF EXISTS friendships_participant ON friendships');
  await knex.raw('ALTER TABLE friendships DISABLE ROW LEVEL SECURITY');
};
