#!/usr/bin/env node
/**
 * Generate a JWT authentication token for a user by UUID
 *
 * Usage:
 *   node scripts/generate-token.js <user-uuid>
 *   node scripts/generate-token.js <user-uuid> --expiry 30d
 *
 * Environment:
 *   JWT_SECRET - Required (loaded from .env)
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { query, pool } = require('../database/pg');

async function generateToken(userId, expiry = '7d') {
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
        console.error('Error: JWT_SECRET not set in environment');
        process.exit(1);
    }

    // Fetch user from database to get username
    const result = await query(
        'SELECT id, username FROM users WHERE id = $1',
        [userId]
    );

    if (result.rows.length === 0) {
        console.error(`Error: User with ID "${userId}" not found`);
        process.exit(1);
    }

    const user = result.rows[0];

    const token = jwt.sign(
        { id: user.id, username: user.username },
        jwtSecret,
        { expiresIn: expiry }
    );

    return { user, token };
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: node scripts/generate-token.js <user-uuid> [options]

Options:
  --expiry <duration>   Token expiration (default: 7d)
                        Examples: 1h, 24h, 7d, 30d, 1y
  --help, -h            Show this help message

Examples:
  node scripts/generate-token.js 123e4567-e89b-12d3-a456-426614174000
  node scripts/generate-token.js 123e4567-e89b-12d3-a456-426614174000 --expiry 30d
`);
        process.exit(0);
    }

    const userId = args[0];
    let expiry = '7d';

    const expiryIndex = args.indexOf('--expiry');
    if (expiryIndex !== -1 && args[expiryIndex + 1]) {
        expiry = args[expiryIndex + 1];
    }

    try {
        const { user, token } = await generateToken(userId, expiry);

        console.log('\n--- Token Generated ---');
        console.log(`User ID:    ${user.id}`);
        console.log(`Username:   ${user.username || '(not set)'}`);
        console.log(`Expires in: ${expiry}`);
        console.log(`\nToken:\n${token}\n`);
    } catch (err) {
        console.error('Error generating token:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
