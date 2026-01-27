const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sslEnabled = process.env.POSTGRES_SSL === 'true' || process.env.POSTGRES_SSL === 'require';
const sslConfig = sslEnabled ? { rejectUnauthorized: false } : false;

const pool = connectionString
    ? new Pool({ connectionString, ssl: sslConfig })
    : new Pool({
        host: process.env.POSTGRES_HOST,
        port: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : 5432,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_NAME || process.env.POSTGRES_DB,
        ssl: sslConfig,
    });

async function check() {
    try {
        const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
        console.log('Tables:', res.rows.map(r => r.table_name));
    } catch (err) {
        console.error('DB Check Error:', err);
    } finally {
        await pool.end();
    }
}

check();
