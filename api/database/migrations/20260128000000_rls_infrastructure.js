/**
 * RLS Infrastructure Migration
 * Creates helper functions for Row Level Security policies
 */

exports.up = async function (knex) {
  // Function to get current user from session variable
  await knex.raw(`
    CREATE OR REPLACE FUNCTION current_app_user_id()
    RETURNS UUID AS $$
    BEGIN
      RETURN NULLIF(current_setting('app.current_user_id', true), '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql STABLE;
  `);

  // Function to check admin status
  await knex.raw(`
    CREATE OR REPLACE FUNCTION is_current_user_admin()
    RETURNS BOOLEAN AS $$
    BEGIN
      RETURN EXISTS (
        SELECT 1 FROM users
        WHERE id = current_app_user_id() AND is_admin = true
      );
    END;
    $$ LANGUAGE plpgsql STABLE;
  `);

  // Function to check friendship between two users
  await knex.raw(`
    CREATE OR REPLACE FUNCTION are_friends(user1 UUID, user2 UUID)
    RETURNS BOOLEAN AS $$
    BEGIN
      RETURN EXISTS (
        SELECT 1 FROM friendships
        WHERE status = 'accepted'
        AND ((requester_id = user1 AND addressee_id = user2)
             OR (requester_id = user2 AND addressee_id = user1))
      );
    END;
    $$ LANGUAGE plpgsql STABLE;
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP FUNCTION IF EXISTS are_friends(UUID, UUID)');
  await knex.raw('DROP FUNCTION IF EXISTS is_current_user_admin()');
  await knex.raw('DROP FUNCTION IF EXISTS current_app_user_id()');
};
