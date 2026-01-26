/**
 * Script to update a user's email address by user ID
 *
 * Usage: node scripts/update-user-email.js <user_id> <new_email>
 *
 * Example: node scripts/update-user-email.js 550e8400-e29b-41d4-a716-446655440000 newemail@example.com
 */
const path = require('path');

// Load .env from api folder
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { pool, query } = require('../database/pg');

// Simple email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// UUID v4 validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function updateUserEmail() {
  const userId = process.argv[2];
  const newEmail = process.argv[3];

  if (!userId || !newEmail) {
    console.error('Usage: node scripts/update-user-email.js <user_id> <new_email>');
    console.error('Example: node scripts/update-user-email.js 550e8400-e29b-41d4-a716-446655440000 newemail@example.com');
    process.exit(1);
  }

  // Validate UUID format
  if (!UUID_REGEX.test(userId)) {
    console.error('Error: Invalid user ID format. Must be a valid UUID.');
    console.error('Example: 550e8400-e29b-41d4-a716-446655440000');
    process.exit(1);
  }

  // Validate email format
  if (!EMAIL_REGEX.test(newEmail)) {
    console.error('Error: Invalid email format.');
    process.exit(1);
  }

  try {
    // Find user by ID
    const findResult = await query(
      'SELECT id, username, email FROM users WHERE id = $1',
      [userId]
    );

    if (findResult.rows.length === 0) {
      console.error(`No user found with ID: ${userId}`);
      process.exit(1);
    }

    const user = findResult.rows[0];

    // Check if new email is same as current
    if (user.email.toLowerCase() === newEmail.toLowerCase()) {
      console.log(`User "${user.username}" already has email: ${newEmail}`);
      process.exit(0);
    }

    // Check if new email is already in use by another user
    const emailCheck = await query(
      'SELECT id, username FROM users WHERE LOWER(email) = LOWER($1) AND id != $2',
      [newEmail, userId]
    );

    if (emailCheck.rows.length > 0) {
      console.error(`Error: Email "${newEmail}" is already in use by user "${emailCheck.rows[0].username}".`);
      process.exit(1);
    }

    // Update the email
    const updateResult = await query(
      'UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, email',
      [newEmail, userId]
    );

    const updatedUser = updateResult.rows[0];
    console.log('Email updated successfully:');
    console.log(`   ID: ${updatedUser.id}`);
    console.log(`   Username: ${updatedUser.username}`);
    console.log(`   Old Email: ${user.email}`);
    console.log(`   New Email: ${updatedUser.email}`);

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    // Wait for pg.js background initialization to complete before closing
    await new Promise(resolve => setTimeout(resolve, 1000));
    await pool.end();
  }
}

updateUserEmail();
