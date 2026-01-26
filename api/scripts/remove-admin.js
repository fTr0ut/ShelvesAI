/**
 * Script to remove admin privileges from a user by email
 *
 * Usage: node scripts/remove-admin.js <email>
 *
 * Example: node scripts/remove-admin.js admin@example.com
 */
const path = require('path');

// Load .env from api folder
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { pool, query } = require('../database/pg');

async function removeAdmin() {
  const email = process.argv[2];

  if (!email) {
    console.error('Usage: node scripts/remove-admin.js <email>');
    console.error('Example: node scripts/remove-admin.js admin@example.com');
    process.exit(1);
  }

  try {
    // Find user by email
    const findResult = await query(
      'SELECT id, username, email, is_admin FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (findResult.rows.length === 0) {
      console.error(`No user found with email: ${email}`);
      process.exit(1);
    }

    const user = findResult.rows[0];

    if (!user.is_admin) {
      console.log(`User "${user.username}" (${user.email}) is not an admin.`);
      process.exit(0);
    }

    // Remove admin privileges
    const updateResult = await query(
      'UPDATE users SET is_admin = false WHERE id = $1 RETURNING id, username, email, is_admin',
      [user.id]
    );

    const updatedUser = updateResult.rows[0];
    console.log(`Admin privileges removed from user:`);
    console.log(`   ID: ${updatedUser.id}`);
    console.log(`   Username: ${updatedUser.username}`);
    console.log(`   Email: ${updatedUser.email}`);
    console.log(`   Is Admin: ${updatedUser.is_admin}`);

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    // Wait for pg.js background initialization to complete before closing
    await new Promise(resolve => setTimeout(resolve, 1000));
    await pool.end();
  }
}

removeAdmin();
