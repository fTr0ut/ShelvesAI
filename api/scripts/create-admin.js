/**
 * Script to grant admin privileges to a user by email
 *
 * Usage: node scripts/create-admin.js <email>
 *
 * Example: node scripts/create-admin.js admin@example.com
 */
const path = require('path');

// Load .env from api folder
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { pool, query } = require('../database/pg');
const logger = require('../logger');

async function createAdmin() {
  const email = process.argv[2];

  if (!email) {
    logger.error('Usage: node scripts/create-admin.js <email>');
    logger.error('Example: node scripts/create-admin.js admin@example.com');
    process.exit(1);
  }

  try {
    // Find user by email
    const findResult = await query(
      'SELECT id, username, email, is_admin FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (findResult.rows.length === 0) {
      logger.error(`❌ No user found with email: ${email}`);
      process.exit(1);
    }

    const user = findResult.rows[0];

    if (user.is_admin) {
      logger.info(`ℹ️  User "${user.username}" (${user.email}) is already an admin.`);
      process.exit(0);
    }

    // Grant admin privileges
    const updateResult = await query(
      'UPDATE users SET is_admin = true WHERE id = $1 RETURNING id, username, email, is_admin',
      [user.id]
    );

    const updatedUser = updateResult.rows[0];
    logger.info(`✅ Admin privileges granted to user:`);
    logger.info(`   ID: ${updatedUser.id}`);
    logger.info(`   Username: ${updatedUser.username}`);
    logger.info(`   Email: ${updatedUser.email}`);
    logger.info(`   Is Admin: ${updatedUser.is_admin}`);

  } catch (err) {
    logger.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    // Wait for pg.js background initialization to complete before closing
    await new Promise(resolve => setTimeout(resolve, 1000));
    await pool.end();
  }
}

createAdmin();
