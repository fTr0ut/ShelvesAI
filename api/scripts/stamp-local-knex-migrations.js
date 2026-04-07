#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { Client } = require('pg');
const logger = require('../logger');
const { loadApiEnv } = require('../loadEnv');

process.env.USE_LOCAL_DB = process.env.USE_LOCAL_DB || '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
loadApiEnv();

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');

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
      `Refusing to stamp migrations for non-local host "${connectionInfo.host}". Set USE_LOCAL_DB=1 with localhost DB settings.`,
    );
  }
}

function getMigrationFiles() {
  return fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.js'))
    .sort();
}

async function main() {
  const connectionConfig = getConnectionConfig();
  const connectionInfo = describeConnection(connectionConfig);
  ensureLocalConnection(connectionInfo);

  const client = new Client(connectionConfig);

  logger.info('Stamping local Knex migration history');
  logger.info('Target DB', connectionInfo);

  try {
    await client.connect();

    const tableCountResult = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('knex_migrations', 'knex_migrations_lock')
    `);
    const tableCount = tableCountResult.rows[0]?.count || 0;
    if (tableCount === 0) {
      throw new Error('Refusing to stamp an empty database. Initialize schema first.');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS knex_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        batch INTEGER,
        migration_time TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS knex_migrations_lock (
        index SERIAL PRIMARY KEY,
        is_locked INTEGER
      )
    `);

    await client.query(`
      INSERT INTO knex_migrations_lock (is_locked)
      SELECT 0
      WHERE NOT EXISTS (SELECT 1 FROM knex_migrations_lock)
    `);

    const existingResult = await client.query('SELECT name FROM knex_migrations');
    const existingNames = new Set(existingResult.rows.map((row) => row.name));
    const batchResult = await client.query('SELECT COALESCE(MAX(batch), 0)::int AS batch FROM knex_migrations');
    const nextBatch = (batchResult.rows[0]?.batch || 0) + 1;

    const migrationFiles = getMigrationFiles();
    let inserted = 0;

    for (const file of migrationFiles) {
      if (existingNames.has(file)) continue;
      await client.query(
        'INSERT INTO knex_migrations (name, batch, migration_time) VALUES ($1, $2, NOW())',
        [file, nextBatch],
      );
      inserted += 1;
    }

    logger.info('Knex migration history stamped', {
      inserted,
      totalMigrationFiles: migrationFiles.length,
      batch: nextBatch,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  logger.error('Failed to stamp local Knex migrations', { error: err.message, stack: err.stack });
  process.exit(1);
});
