#!/usr/bin/env node
/**
 * Database Initialization Script
 *
 * Usage:
 *   node scripts/init-db.js [options]
 *
 * Options:
 *   --fresh     Apply full schema SQL (for new databases only)
 *   --migrate   Run Knex migrations (default, safe for existing databases)
 *   --check     Check database connection and migration status
 *
 * Examples:
 *   npm run init-db              # Run pending migrations
 *   npm run init-db -- --fresh   # Initialize fresh database with full schema
 *   npm run init-db -- --check   # Check connection and status
 */

const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const { Pool } = require('pg');

// Build connection config (matching knexfile.js env vars)
const connectionString = process.env.DATABASE_URL;
const poolConfig = connectionString
  ? { connectionString, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      database: process.env.DB_NAME || 'shelvesai',
      user: process.env.DB_USER || 'shelves',
      password: process.env.DB_PASSWORD || 'localdev123',
    };

const pool = new Pool(poolConfig);

/**
 * Check database connection
 */
async function checkConnection() {
  try {
    const result = await pool.query('SELECT NOW() as time, current_database() as db');
    console.log(`Connected to database: ${result.rows[0].db}`);
    console.log(`Server time: ${result.rows[0].time}`);
    return true;
  } catch (err) {
    console.error('Connection failed:', err.message);
    return false;
  }
}

/**
 * Check if any tables exist (to determine if fresh install)
 */
async function hasExistingTables() {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name != 'knex_migrations'
      AND table_name != 'knex_migrations_lock'
  `);
  return parseInt(result.rows[0].count, 10) > 0;
}

/**
 * Get migration status
 */
async function getMigrationStatus() {
  try {
    const result = await pool.query(`
      SELECT name, migration_time
      FROM knex_migrations
      ORDER BY id DESC
      LIMIT 5
    `);
    return result.rows;
  } catch (err) {
    // Table doesn't exist yet
    return null;
  }
}

/**
 * Apply full schema SQL file (fresh install only)
 */
async function applyFreshSchema() {
  const schemaPath = path.join(__dirname, '../database/init/01-schema.sql');

  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema file not found: ${schemaPath}`);
    process.exit(1);
  }

  console.log('Reading schema file...');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  console.log('Applying schema (this may take a moment)...');
  await pool.query(schemaSql);

  // Create knex_migrations table to track that we started fresh
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knex_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      batch INTEGER,
      migration_time TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knex_migrations_lock (
      index SERIAL PRIMARY KEY,
      is_locked INTEGER
    )
  `);

  // Insert placeholder to indicate fresh schema was applied
  await pool.query(`
    INSERT INTO knex_migrations (name, batch, migration_time)
    VALUES ('00000000000000_fresh_schema.js', 0, NOW())
  `);

  console.log('Schema applied successfully!');
}

/**
 * Run Knex migrations
 */
async function runMigrations() {
  // Close our pool before running Knex (it creates its own)
  await pool.end();

  const knex = require('knex');
  const knexConfig = require('../knexfile');

  const env = process.env.NODE_ENV || 'development';
  const db = knex(knexConfig[env]);

  try {
    console.log('Running migrations...');
    const [batch, migrations] = await db.migrate.latest();

    if (migrations.length === 0) {
      console.log('Database is up to date. No migrations to run.');
    } else {
      console.log(`Batch ${batch}: Applied ${migrations.length} migration(s):`);
      migrations.forEach((m) => console.log(`  - ${m}`));
    }
  } finally {
    await db.destroy();
  }
}

/**
 * Show current status
 */
async function showStatus() {
  const connected = await checkConnection();
  if (!connected) {
    process.exit(1);
  }

  const hasTables = await hasExistingTables();
  console.log(`\nExisting tables: ${hasTables ? 'Yes' : 'No (fresh database)'}`);

  const migrations = await getMigrationStatus();
  if (migrations === null) {
    console.log('Migration tracking: Not initialized');
  } else if (migrations.length === 0) {
    console.log('Migrations: None recorded');
  } else {
    console.log('\nRecent migrations:');
    migrations.forEach((m) => {
      const time = new Date(m.migration_time).toLocaleString();
      console.log(`  ${m.name} (${time})`);
    });
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--fresh') ? 'fresh'
    : args.includes('--check') ? 'check'
    : 'migrate';

  console.log('ShelvesAI Database Initialization');
  console.log('==================================\n');

  try {
    if (mode === 'check') {
      await showStatus();
      await pool.end();
      return;
    }

    const connected = await checkConnection();
    if (!connected) {
      process.exit(1);
    }

    if (mode === 'fresh') {
      const hasTables = await hasExistingTables();
      if (hasTables) {
        console.error('\nERROR: Database already has tables.');
        console.error('Fresh schema can only be applied to empty databases.');
        console.error('Use --migrate for existing databases, or drop all tables first.');
        await pool.end();
        process.exit(1);
      }

      await applyFreshSchema();
      await pool.end();
      console.log('\nDone! Database initialized with fresh schema.');
    } else {
      // Default: run migrations
      await runMigrations();
      console.log('\nDone! Database is up to date.');
    }
  } catch (err) {
    console.error('\nError:', err.message);
    if (process.env.NODE_ENV !== 'production') {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
