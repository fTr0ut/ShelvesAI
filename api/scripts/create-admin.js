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

async function createAdmin() {
  const email = process.argv[2];

  if (!email) {
    console.error('Usage: node scripts/create-admin.js <email>');
    console.error('Example: node scripts/create-admin.js admin@example.com');
    process.exit(1);
  }

  try {
    // Find user by email
    const findResult = await query(
      'SELECT id, username, email, is_admin FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (findResult.rows.length === 0) {
      console.error(`❌ No user found with email: ${email}`);
      process.exit(1);
    }

    const user = findResult.rows[0];

    if (user.is_admin) {
      console.log(`ℹ️  User "${user.username}" (${user.email}) is already an admin.`);
      process.exit(0);
    }

    // Grant admin privileges
    const updateResult = await query(
      'UPDATE users SET is_admin = true WHERE id = $1 RETURNING id, username, email, is_admin',
      [user.id]
    );

    const updatedUser = updateResult.rows[0];
    console.log(`✅ Admin privileges granted to user:`);
    console.log(`   ID: ${updatedUser.id}`);
    console.log(`   Username: ${updatedUser.username}`);
    console.log(`   Email: ${updatedUser.email}`);
    console.log(`   Is Admin: ${updatedUser.is_admin}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createAdmin();
