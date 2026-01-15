import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const apiRequire = createRequire(path.join(__dirname, '../api/package.json'));
const dotenv = apiRequire('dotenv');
const { Pool } = apiRequire('pg');

dotenv.config({ path: path.join(__dirname, '../api/.env') });

const REQUIRED_ENV = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getActiveClause(columns) {
  if (columns.has('deleted_at')) return 'deleted_at IS NULL';
  if (columns.has('is_deleted')) return 'is_deleted = false';
  if (columns.has('is_active')) return 'is_active = true';
  return null;
}

async function run() {
  for (const name of REQUIRED_ENV) {
    requireEnv(name);
  }

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  try {
    const tableRes = await pool.query(`SELECT to_regclass('public.notifications') as name`);
    const tableName = tableRes.rows[0]?.name;
    if (!tableName) {
      console.log('notifications table not found. Skipping DB checks.');
      return;
    }

    const columnsRes = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
       AND table_name = 'notifications'`
    );
    const columns = new Set(columnsRes.rows.map((row) => row.column_name));
    const activeClause = getActiveClause(columns);

    if (!activeClause) {
      console.warn('No soft-delete column detected (deleted_at, is_deleted, is_active).');
    }

    const friendRequestSql = `
      SELECT user_id, actor_id, entity_id, COUNT(*) as count
      FROM notifications
      WHERE type = 'friend_request'
      ${activeClause ? `AND ${activeClause}` : ''}
      GROUP BY user_id, actor_id, entity_id
      HAVING COUNT(*) > 1`;
    const friendDupes = await pool.query(friendRequestSql);
    if (friendDupes.rows.length) {
      console.error('Duplicate friend_request notifications detected:', friendDupes.rows);
      process.exitCode = 1;
    } else {
      console.log('No duplicate friend_request notifications found.');
    }

    const likeSql = `
      SELECT user_id, actor_id, entity_id,
             COUNT(*) FILTER (WHERE ${activeClause || 'true'}) as active_count,
             COUNT(*) as total_count
      FROM notifications
      WHERE type = 'like'
      GROUP BY user_id, actor_id, entity_id
      HAVING COUNT(*) FILTER (WHERE ${activeClause || 'true'}) > 1`;
    const likeDupes = await pool.query(likeSql);
    if (likeDupes.rows.length) {
      console.error('Multiple active like notifications detected:', likeDupes.rows);
      process.exitCode = 1;
    } else {
      console.log('No multiple-active like notifications found.');
    }
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Notification DB verification failed:', err.message);
  process.exitCode = 1;
});
