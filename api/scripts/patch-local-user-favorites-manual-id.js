#!/usr/bin/env node

const { URL } = require('url');
const { Client } = require('pg');
const logger = require('../logger');
const { loadApiEnv } = require('../loadEnv');

process.env.USE_LOCAL_DB = process.env.USE_LOCAL_DB || '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
loadApiEnv();

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function getConnectionConfig() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (connectionString) {
    return { connectionString, ssl: false };
  }

  return {
    host: process.env.POSTGRES_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || process.env.DB_PORT || '5432', 10),
    database: process.env.POSTGRES_NAME || process.env.POSTGRES_DB || process.env.DB_NAME || 'shelvesai',
    user: process.env.POSTGRES_USER || process.env.DB_USER || 'shelves',
    password: process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || 'localdev123',
    ssl: false,
  };
}

function describeConnection(config) {
  if (config.connectionString) {
    const parsed = new URL(config.connectionString);
    return {
      host: parsed.hostname || 'localhost',
      port: parsed.port ? parseInt(parsed.port, 10) : 5432,
      database: parsed.pathname.replace(/^\//, '') || 'postgres',
      user: decodeURIComponent(parsed.username || ''),
    };
  }

  return {
    host: config.host || 'localhost',
    port: parseInt(config.port || '5432', 10),
    database: config.database || 'postgres',
    user: config.user || '',
  };
}

function ensureLocalConnection(connectionInfo) {
  if (!LOCAL_HOSTS.has(String(connectionInfo.host || '').toLowerCase())) {
    throw new Error(
      `Refusing to patch user_favorites on non-local host "${connectionInfo.host}". Set USE_LOCAL_DB=1 with localhost DB settings.`,
    );
  }
}

async function main() {
  const connectionConfig = getConnectionConfig();
  const connectionInfo = describeConnection(connectionConfig);
  ensureLocalConnection(connectionInfo);

  const client = new Client(connectionConfig);

  logger.info('Patching local user_favorites schema', connectionInfo);

  try {
    await client.connect();

    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE user_favorites
        ADD COLUMN IF NOT EXISTS manual_id INTEGER REFERENCES user_manuals(id) ON DELETE CASCADE
    `);

    await client.query(`
      ALTER TABLE user_favorites
        ALTER COLUMN collectable_id DROP NOT NULL
    `);

    await client.query(`
      ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS user_favorites_user_id_collectable_id_key
    `);
    await client.query(`
      ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS user_favorites_user_id_collectable_id_unique
    `);
    await client.query(`
      ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS favourites_item_check
    `);
    await client.query(`
      ALTER TABLE user_favorites
      ADD CONSTRAINT favourites_item_check
      CHECK (
        (collectable_id IS NOT NULL AND manual_id IS NULL) OR
        (collectable_id IS NULL AND manual_id IS NOT NULL)
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_favorites_unique_collectable
      ON user_favorites (user_id, collectable_id)
      WHERE collectable_id IS NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_favorites_unique_manual
      ON user_favorites (user_id, manual_id)
      WHERE manual_id IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_favorites_manual
      ON user_favorites (manual_id)
    `);

    await client.query('COMMIT');

    const columns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_favorites'
      ORDER BY ordinal_position
    `);

    logger.info('user_favorites schema patched', {
      columns: columns.rows.map((row) => row.column_name),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  logger.error('Failed to patch local user_favorites schema', { error: err.message, stack: err.stack });
  process.exit(1);
});
