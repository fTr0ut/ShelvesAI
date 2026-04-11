exports.up = async function (knex) {
  await knex.schema.createTable('user_blocks', (table) => {
    table.increments('id').primary();
    table.uuid('blocker_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('blocked_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['blocker_id', 'blocked_id']);
  });

  await knex.raw(`
    ALTER TABLE user_blocks
    ADD CONSTRAINT user_blocks_no_self_block
    CHECK (blocker_id <> blocked_id)
  `);

  await knex.raw(`
    CREATE INDEX idx_user_blocks_blocker_id
    ON user_blocks(blocker_id)
  `);

  await knex.raw(`
    CREATE INDEX idx_user_blocks_blocked_id
    ON user_blocks(blocked_id)
  `);

  await knex.raw(`
    INSERT INTO user_blocks (blocker_id, blocked_id, created_at)
    SELECT requester_id, addressee_id, COALESCE(updated_at, created_at, NOW())
    FROM friendships
    WHERE status = 'blocked'
    ON CONFLICT (blocker_id, blocked_id) DO NOTHING
  `);

  await knex.raw(`
    DELETE FROM friendships
    WHERE status = 'blocked'
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION users_are_blocked(user1 UUID, user2 UUID)
    RETURNS BOOLEAN AS $$
    BEGIN
      IF user1 IS NULL OR user2 IS NULL OR user1 = user2 THEN
        RETURN FALSE;
      END IF;

      RETURN EXISTS (
        SELECT 1
        FROM user_blocks
        WHERE (blocker_id = user1 AND blocked_id = user2)
           OR (blocker_id = user2 AND blocked_id = user1)
      );
    END;
    $$ LANGUAGE plpgsql STABLE;
  `);

  await knex.raw('ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY');
  await knex.raw(`
    CREATE POLICY user_blocks_participant ON user_blocks
    USING (
      blocker_id = current_app_user_id()
      OR blocked_id = current_app_user_id()
      OR is_current_user_admin()
    )
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP POLICY IF EXISTS user_blocks_participant ON user_blocks');
  await knex.raw('ALTER TABLE user_blocks DISABLE ROW LEVEL SECURITY');
  await knex.raw('DROP FUNCTION IF EXISTS users_are_blocked(UUID, UUID)');
  await knex.schema.dropTableIfExists('user_blocks');
};
