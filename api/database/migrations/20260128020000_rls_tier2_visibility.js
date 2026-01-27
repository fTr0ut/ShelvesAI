/**
 * RLS Tier 2: Visibility-Based Access
 * Tables with public/friends/private visibility settings
 */

exports.up = async function (knex) {
  // ============================================
  // SHELVES - owner_id + visibility
  // ============================================
  await knex.raw('ALTER TABLE shelves ENABLE ROW LEVEL SECURITY');

  // Owner: full access
  await knex.raw(`
    CREATE POLICY shelves_owner ON shelves
      FOR ALL
      USING (owner_id = current_app_user_id())
      WITH CHECK (owner_id = current_app_user_id())
  `);

  // Others: read based on visibility
  await knex.raw(`
    CREATE POLICY shelves_read ON shelves
      FOR SELECT
      USING (
        visibility = 'public'
        OR (visibility = 'friends' AND are_friends(owner_id, current_app_user_id()))
      )
  `);

  // Admin: full access
  await knex.raw(`
    CREATE POLICY shelves_admin ON shelves
      FOR ALL
      USING (is_current_user_admin())
      WITH CHECK (is_current_user_admin())
  `);

  // ============================================
  // USER_LISTS - user_id + visibility
  // ============================================
  await knex.raw('ALTER TABLE user_lists ENABLE ROW LEVEL SECURITY');

  // Owner: full access
  await knex.raw(`
    CREATE POLICY user_lists_owner ON user_lists
      FOR ALL
      USING (user_id = current_app_user_id())
      WITH CHECK (user_id = current_app_user_id())
  `);

  // Others: read based on visibility
  await knex.raw(`
    CREATE POLICY user_lists_read ON user_lists
      FOR SELECT
      USING (
        visibility = 'public'
        OR (visibility = 'friends' AND are_friends(user_id, current_app_user_id()))
      )
  `);

  // Admin: full access
  await knex.raw(`
    CREATE POLICY user_lists_admin ON user_lists
      FOR ALL
      USING (is_current_user_admin())
      WITH CHECK (is_current_user_admin())
  `);

  // ============================================
  // WISHLISTS - user_id + visibility
  // ============================================
  await knex.raw('ALTER TABLE wishlists ENABLE ROW LEVEL SECURITY');

  // Owner: full access
  await knex.raw(`
    CREATE POLICY wishlists_owner ON wishlists
      FOR ALL
      USING (user_id = current_app_user_id())
      WITH CHECK (user_id = current_app_user_id())
  `);

  // Others: read based on visibility
  await knex.raw(`
    CREATE POLICY wishlists_read ON wishlists
      FOR SELECT
      USING (
        visibility = 'public'
        OR (visibility = 'friends' AND are_friends(user_id, current_app_user_id()))
      )
  `);

  // Admin: full access
  await knex.raw(`
    CREATE POLICY wishlists_admin ON wishlists
      FOR ALL
      USING (is_current_user_admin())
      WITH CHECK (is_current_user_admin())
  `);

  // ============================================
  // EVENT_AGGREGATES - access based on linked shelf visibility
  // ============================================
  await knex.raw('ALTER TABLE event_aggregates ENABLE ROW LEVEL SECURITY');

  // Owner: full access to own events
  await knex.raw(`
    CREATE POLICY event_aggregates_owner ON event_aggregates
      FOR ALL
      USING (user_id = current_app_user_id())
      WITH CHECK (user_id = current_app_user_id())
  `);

  // Others: read based on shelf visibility
  await knex.raw(`
    CREATE POLICY event_aggregates_read ON event_aggregates
      FOR SELECT
      USING (
        -- No shelf = public event
        shelf_id IS NULL
        OR EXISTS (
          SELECT 1 FROM shelves s
          WHERE s.id = event_aggregates.shelf_id
          AND (
            s.visibility = 'public'
            OR (s.visibility = 'friends' AND are_friends(s.owner_id, current_app_user_id()))
          )
        )
      )
  `);

  // Admin: full access
  await knex.raw(`
    CREATE POLICY event_aggregates_admin ON event_aggregates
      FOR ALL
      USING (is_current_user_admin())
      WITH CHECK (is_current_user_admin())
  `);
};

exports.down = async function (knex) {
  // event_aggregates
  await knex.raw('DROP POLICY IF EXISTS event_aggregates_admin ON event_aggregates');
  await knex.raw('DROP POLICY IF EXISTS event_aggregates_read ON event_aggregates');
  await knex.raw('DROP POLICY IF EXISTS event_aggregates_owner ON event_aggregates');
  await knex.raw('ALTER TABLE event_aggregates DISABLE ROW LEVEL SECURITY');

  // wishlists
  await knex.raw('DROP POLICY IF EXISTS wishlists_admin ON wishlists');
  await knex.raw('DROP POLICY IF EXISTS wishlists_read ON wishlists');
  await knex.raw('DROP POLICY IF EXISTS wishlists_owner ON wishlists');
  await knex.raw('ALTER TABLE wishlists DISABLE ROW LEVEL SECURITY');

  // user_lists
  await knex.raw('DROP POLICY IF EXISTS user_lists_admin ON user_lists');
  await knex.raw('DROP POLICY IF EXISTS user_lists_read ON user_lists');
  await knex.raw('DROP POLICY IF EXISTS user_lists_owner ON user_lists');
  await knex.raw('ALTER TABLE user_lists DISABLE ROW LEVEL SECURITY');

  // shelves
  await knex.raw('DROP POLICY IF EXISTS shelves_admin ON shelves');
  await knex.raw('DROP POLICY IF EXISTS shelves_read ON shelves');
  await knex.raw('DROP POLICY IF EXISTS shelves_owner ON shelves');
  await knex.raw('ALTER TABLE shelves DISABLE ROW LEVEL SECURITY');
};
