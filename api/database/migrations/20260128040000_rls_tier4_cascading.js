/**
 * RLS Tier 4: Cascading Access
 * Tables where access is determined by parent entity visibility
 */

exports.up = async function (knex) {
  // ============================================
  // EVENT_LOGS - access based on parent aggregate/shelf visibility
  // ============================================
  await knex.raw('ALTER TABLE event_logs ENABLE ROW LEVEL SECURITY');

  // Owner: full access to own events
  await knex.raw(`
    CREATE POLICY event_logs_owner ON event_logs
      FOR ALL
      USING (user_id = current_app_user_id())
      WITH CHECK (user_id = current_app_user_id())
  `);

  // Others: read based on aggregate's shelf visibility
  await knex.raw(`
    CREATE POLICY event_logs_access ON event_logs
      FOR SELECT
      USING (
        user_id = current_app_user_id()
        OR EXISTS (
          SELECT 1 FROM event_aggregates ea
          LEFT JOIN shelves s ON s.id = ea.shelf_id
          WHERE ea.id = event_logs.aggregate_id
          AND (
            -- No shelf = public event
            ea.shelf_id IS NULL
            OR s.visibility = 'public'
            OR (s.visibility = 'friends' AND are_friends(s.owner_id, current_app_user_id()))
          )
        )
      )
  `);

  // Admin: full access
  await knex.raw(`
    CREATE POLICY event_logs_admin ON event_logs
      FOR ALL
      USING (is_current_user_admin())
      WITH CHECK (is_current_user_admin())
  `);

  // ============================================
  // USER_LIST_ITEMS - access based on parent list visibility
  // ============================================
  await knex.raw('ALTER TABLE user_list_items ENABLE ROW LEVEL SECURITY');

  // Owner: full access via parent list
  await knex.raw(`
    CREATE POLICY user_list_items_owner ON user_list_items
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM user_lists ul
          WHERE ul.id = user_list_items.list_id
          AND ul.user_id = current_app_user_id()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM user_lists ul
          WHERE ul.id = user_list_items.list_id
          AND ul.user_id = current_app_user_id()
        )
      )
  `);

  // Others: read based on list visibility
  await knex.raw(`
    CREATE POLICY user_list_items_read ON user_list_items
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM user_lists ul
          WHERE ul.id = user_list_items.list_id
          AND (
            ul.visibility = 'public'
            OR (ul.visibility = 'friends' AND are_friends(ul.user_id, current_app_user_id()))
          )
        )
      )
  `);

  // Admin: full access
  await knex.raw(`
    CREATE POLICY user_list_items_admin ON user_list_items
      FOR ALL
      USING (is_current_user_admin())
      WITH CHECK (is_current_user_admin())
  `);

  // ============================================
  // WISHLIST_ITEMS - access based on parent wishlist visibility
  // ============================================
  await knex.raw('ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY');

  // Owner: full access via parent wishlist
  await knex.raw(`
    CREATE POLICY wishlist_items_owner ON wishlist_items
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM wishlists w
          WHERE w.id = wishlist_items.wishlist_id
          AND w.user_id = current_app_user_id()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM wishlists w
          WHERE w.id = wishlist_items.wishlist_id
          AND w.user_id = current_app_user_id()
        )
      )
  `);

  // Others: read based on wishlist visibility
  await knex.raw(`
    CREATE POLICY wishlist_items_read ON wishlist_items
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM wishlists w
          WHERE w.id = wishlist_items.wishlist_id
          AND (
            w.visibility = 'public'
            OR (w.visibility = 'friends' AND are_friends(w.user_id, current_app_user_id()))
          )
        )
      )
  `);

  // Admin: full access
  await knex.raw(`
    CREATE POLICY wishlist_items_admin ON wishlist_items
      FOR ALL
      USING (is_current_user_admin())
      WITH CHECK (is_current_user_admin())
  `);
};

exports.down = async function (knex) {
  // wishlist_items
  await knex.raw('DROP POLICY IF EXISTS wishlist_items_admin ON wishlist_items');
  await knex.raw('DROP POLICY IF EXISTS wishlist_items_read ON wishlist_items');
  await knex.raw('DROP POLICY IF EXISTS wishlist_items_owner ON wishlist_items');
  await knex.raw('ALTER TABLE wishlist_items DISABLE ROW LEVEL SECURITY');

  // user_list_items
  await knex.raw('DROP POLICY IF EXISTS user_list_items_admin ON user_list_items');
  await knex.raw('DROP POLICY IF EXISTS user_list_items_read ON user_list_items');
  await knex.raw('DROP POLICY IF EXISTS user_list_items_owner ON user_list_items');
  await knex.raw('ALTER TABLE user_list_items DISABLE ROW LEVEL SECURITY');

  // event_logs
  await knex.raw('DROP POLICY IF EXISTS event_logs_admin ON event_logs');
  await knex.raw('DROP POLICY IF EXISTS event_logs_access ON event_logs');
  await knex.raw('DROP POLICY IF EXISTS event_logs_owner ON event_logs');
  await knex.raw('ALTER TABLE event_logs DISABLE ROW LEVEL SECURITY');
};
