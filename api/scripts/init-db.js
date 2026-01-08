const fs = require('fs');
const path = require('path');
const { pool } = require('../database/pg');

async function init() {
    try {
        console.log('Using database configuration from pg.js');

        // Wait a moment for pool to be ready/connected
        await new Promise(resolve => setTimeout(resolve, 1000));

        const schemaPath = path.join(__dirname, '../database/init/01-schema.sql');
        console.log(`Reading schema from: ${schemaPath}`);
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('Running schema...');

        // Split schema? No, pg driver can execute multiple statements usually?
        // standard 'pg' driver query() supports multiple statements if simple.
        // Otherwise might need readFileSync and client.query.
        // pool.query() is valid.

        await pool.query(schemaSql);
        console.log('✅ Schema applied successfully!');

    } catch (err) {
        console.error('❌ Init DB Error:', err);
    } finally {
        await pool.end();
    }
}

init();
