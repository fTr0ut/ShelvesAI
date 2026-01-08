require('dotenv').config();
const { query, pool } = require('./pg');

async function test() {
    try {
        const result = await query('SELECT NOW() as time, current_database() as db');
        console.log('Connection successful:', result.rows[0]);

        const tables = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
        console.log('Tables:', tables.rows.map(r => r.table_name));

        await pool.end();
        process.exit(0);
    } catch (err) {
        console.error('Connection failed:', err);
        process.exit(1);
    }
}

test();
