/**
 * RLS Tier 1: Simple User Isolation
 * Tables where users can only access their own rows via user_id column
 */

const SIMPLE_USER_TABLES = [
  'user_collections',
  'user_manuals',
  'user_ratings',
  'needs_review',
  'profile_media',
  'push_device_tokens',
  'notification_preferences',
  'password_reset_tokens',
  'user_vision_quota',
  'user_favorites',
  'user_news_seen',
  'user_news_dismissed',
  'event_likes',
  'event_comments',
];

exports.up = async function (knex) {
  // Enable RLS and create policies for simple user isolation tables
  for (const table of SIMPLE_USER_TABLES) {
    // Check if table exists before applying RLS
    const exists = await knex.schema.hasTable(table);
    if (!exists) {
      console.log(`Skipping RLS for ${table} - table does not exist`);
      continue;
    }

    await knex.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);

    await knex.raw(`
      CREATE POLICY ${table}_isolation ON ${table}
        FOR ALL
        USING (user_id = current_app_user_id())
        WITH CHECK (user_id = current_app_user_id())
    `);

    // Allow admin bypass
    await knex.raw(`
      CREATE POLICY ${table}_admin ON ${table}
        FOR ALL
        USING (is_current_user_admin())
        WITH CHECK (is_current_user_admin())
    `);
  }

  // Special handling for users table
  await knex.raw('ALTER TABLE users ENABLE ROW LEVEL SECURITY');

  // Self: full access
  await knex.raw(`
    CREATE POLICY users_self ON users
      FOR ALL
      USING (id = current_app_user_id())
      WITH CHECK (id = current_app_user_id())
  `);

  // Others: read non-suspended profiles only
  await knex.raw(`
    CREATE POLICY users_read_others ON users
      FOR SELECT
      USING (is_suspended = false)
  `);

  // Admin: full access to all users
  await knex.raw(`
    CREATE POLICY users_admin ON users
      FOR ALL
      USING (is_current_user_admin())
      WITH CHECK (is_current_user_admin())
  `);
};

exports.down = async function (knex) {
  // Drop users table policies
  await knex.raw('DROP POLICY IF EXISTS users_admin ON users');
  await knex.raw('DROP POLICY IF EXISTS users_read_others ON users');
  await knex.raw('DROP POLICY IF EXISTS users_self ON users');
  await knex.raw('ALTER TABLE users DISABLE ROW LEVEL SECURITY');

  // Drop policies for simple user isolation tables
  for (const table of SIMPLE_USER_TABLES) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;

    await knex.raw(`DROP POLICY IF EXISTS ${table}_admin ON ${table}`);
    await knex.raw(`DROP POLICY IF EXISTS ${table}_isolation ON ${table}`);
    await knex.raw(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  }
};
