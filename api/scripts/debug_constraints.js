const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkConstraints() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT conname, pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE conrelid = 'user_favorites'::regclass;
        `);
        console.log('Constraints on user_favorites:', res.rows);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkConstraints();
