#!/usr/bin/env node
/**
 * Database Drop Script
 *
 * WARNING: This script permanently deletes all data!
 *
 * Usage:
 *   node scripts/drop-db.js [options]
 *
 * Options:
 *   --confirm   Required flag to actually execute the drop
 *   --tables    Drop all tables only (keeps extensions)
 *   --full      Drop everything including extensions (default)
 *
 * Examples:
 *   npm run drop-db                    # Dry run - shows what would be dropped
 *   npm run drop-db -- --confirm       # Actually drop everything
 *   npm run drop-db -- --tables --confirm  # Drop tables only, keep extensions
 */

const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const { Pool } = require('pg');

// Build connection config (matching knexfile.js env vars)
const connectionString = process.env.DATABASE_URL;
const poolConfig = connectionString
  ? { connectionString, ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false }
  : {
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
    database: process.env.POSTGRES_NAME,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD
  };

const pool = new Pool(poolConfig);

/**
 * Get all tables in the public schema
 */
async function getAllTables() {
  const result = await pool.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  return result.rows.map((r) => r.tablename);
}

/**
 * Get all user-defined functions (excludes extension functions)
 */
async function getCustomFunctions() {
  const result = await pool.query(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND d.objid IS NULL
  `);
  return result.rows.map((r) => ({ name: r.proname, args: r.args }));
}

/**
 * Get all extensions
 */
async function getExtensions() {
  const result = await pool.query(`
    SELECT extname
    FROM pg_extension
    WHERE extname != 'plpgsql'
  `);
  return result.rows.map((r) => r.extname);
}

/**
 * Drop all tables using CASCADE
 */
async function dropAllTables(dryRun = true) {
  const tables = await getAllTables();

  if (tables.length === 0) {
    console.log('No tables found.');
    return;
  }

  console.log(`\nTables to drop (${tables.length}):`);
  tables.forEach((t) => console.log(`  - ${t}`));

  if (dryRun) {
    console.log('\n[DRY RUN] No tables were dropped.');
    return;
  }

  // Drop all tables in one statement with CASCADE
  const tableList = tables.map((t) => `"${t}"`).join(', ');
  await pool.query(`DROP TABLE IF EXISTS ${tableList} CASCADE`);
  console.log(`\nDropped ${tables.length} table(s).`);
}

/**
 * Drop all user-defined functions
 */
async function dropAllFunctions(dryRun = true) {
  const functions = await getCustomFunctions();

  if (functions.length === 0) {
    console.log('No user-defined functions found.');
    return;
  }

  console.log(`\nFunctions to drop (${functions.length}):`);
  functions.forEach((f) => console.log(`  - ${f.name}(${f.args})`));

  if (dryRun) {
    console.log('\n[DRY RUN] No functions were dropped.');
    return;
  }

  for (const func of functions) {
    await pool.query(`DROP FUNCTION IF EXISTS "${func.name}"(${func.args}) CASCADE`);
  }
  console.log(`\nDropped ${functions.length} function(s).`);
}

/**
 * Drop all extensions
 */
async function dropAllExtensions(dryRun = true) {
  const extensions = await getExtensions();

  if (extensions.length === 0) {
    console.log('No extensions found.');
    return;
  }

  console.log(`\nExtensions to drop (${extensions.length}):`);
  extensions.forEach((e) => console.log(`  - ${e}`));

  if (dryRun) {
    console.log('\n[DRY RUN] No extensions were dropped.');
    return;
  }

  for (const ext of extensions) {
    await pool.query(`DROP EXTENSION IF EXISTS "${ext}" CASCADE`);
  }
  console.log(`\nDropped ${extensions.length} extension(s).`);
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--confirm');
  const tablesOnly = args.includes('--tables');
  const dryRun = !confirmed;

  console.log('ShelvesAI Database Drop Script');
  console.log('==============================\n');

  // Safety check for production
  if (process.env.NODE_ENV === 'production' && confirmed) {
    console.error('ERROR: Cannot drop database in production environment.');
    console.error('Set NODE_ENV to development or remove the production safeguard.');
    process.exit(1);
  }

  try {
    // Test connection
    const result = await pool.query('SELECT current_database() as db');
    console.log(`Connected to database: ${result.rows[0].db}`);

    if (dryRun) {
      console.log('\n*** DRY RUN MODE ***');
      console.log('Add --confirm flag to actually drop objects.\n');
    } else {
      console.log('\n*** DESTRUCTIVE MODE ***');
      console.log('All data will be permanently deleted!\n');
    }

    // Drop tables
    await dropAllTables(dryRun);

    // Drop functions
    await dropAllFunctions(dryRun);

    // Drop extensions (unless --tables flag)
    if (!tablesOnly) {
      await dropAllExtensions(dryRun);
    }

    if (!dryRun) {
      console.log('\nDatabase has been reset.');
      console.log('Run `npm run init-db:fresh` to reinitialize.');
    }
  } catch (err) {
    console.error('\nError:', err.message);
    if (process.env.NODE_ENV !== 'production') {
      console.error(err.stack);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
