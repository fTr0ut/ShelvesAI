/**
 * Audit for cross-user login identifier collisions where one user's username
 * matches another user's email (case-insensitive). These accounts would be
 * ambiguous once consumer login accepts username or email.
 *
 * Usage: node scripts/audit-login-identifier-collisions.js
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env.local'), override: true });

const { pool, query } = require('../database/pg');
const logger = require('../logger');

async function auditLoginIdentifierCollisions() {
  try {
    const result = await query(
      `SELECT
          username_user.id AS username_user_id,
          username_user.username AS username_value,
          email_user.id AS email_user_id,
          email_user.email AS email_value
        FROM users AS username_user
        JOIN users AS email_user
          ON username_user.id <> email_user.id
         AND username_user.username IS NOT NULL
         AND LOWER(username_user.username) = LOWER(email_user.email)
       ORDER BY LOWER(username_user.username), username_user.id, email_user.id`
    );

    if (result.rows.length === 0) {
      logger.info('No cross-user username/email login identifier collisions found.');
      return;
    }

    logger.warn(`Found ${result.rows.length} cross-user username/email collision(s):`);
    result.rows.forEach((row, index) => {
      logger.warn(
        `${index + 1}. username user ${row.username_user_id} (${row.username_value}) conflicts with email user ${row.email_user_id} (${row.email_value})`
      );
    });
    process.exitCode = 1;
  } catch (err) {
    logger.error('Failed to audit login identifier collisions:', err);
    process.exitCode = 1;
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await pool.end();
  }
}

auditLoginIdentifierCollisions();
