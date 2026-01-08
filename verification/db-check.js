const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../api/.env') });

const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
});

async function check() {
    try {
        const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
        console.log('Tables:', res.rows.map(r => r.table_name));

        // Check users table columns
        if (res.rows.find(r => r.table_name === 'users')) {
            const cols = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'users'
      `);
            console.log('Users columns:', cols.rows.map(c => `${c.column_name}(${c.data_type})`));
        }
    } catch (err) {
        console.error('DB Check Error:', err);
    } finally {
        await pool.end();
    }
}

check();
