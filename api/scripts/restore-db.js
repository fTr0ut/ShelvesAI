#!/usr/bin/env node
/**
 * Database Restore Script
 *
 * Restores a PostgreSQL backup file to the database.
 *
 * Usage:
 *   node scripts/restore-db.js <backup-file> [options]
 *
 * Options:
 *   --confirm     Required flag to actually execute the restore
 *   --clean       Drop existing data before restoring (uses drop-db logic)
 *   --no-owner    Ignore ownership commands in the backup (useful for different users)
 *
 * Supported formats:
 *   - .sql        Plain SQL dump (from pg_dump --format=plain)
 *   - .dump       Custom format (from pg_dump --format=custom)
 *   - .sql.gz     Gzipped SQL dump
 *
 * Examples:
 *   npm run restore-db backup.sql              # Dry run - shows what would happen
 *   npm run restore-db backup.sql -- --confirm # Actually restore
 *   npm run restore-db backup.sql -- --clean --confirm  # Drop existing, then restore
 *   npm run restore-db backup.dump -- --no-owner --confirm  # Restore custom format
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const zlib = require('zlib');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const { Pool } = require('pg');

// Build connection config (matching knexfile.js env vars)
const connectionString = process.env.DATABASE_URL;
const poolMode = process.env.POSTGRES_POOL;
const sslConfig = process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false;

// Build pool config
let poolConfig;
if (connectionString) {
  // Append pooler mode to connection string if specified (for Supabase PgBouncer)
  let connStr = connectionString;
  if (poolMode && !connStr.includes('options=')) {
    const separator = connStr.includes('?') ? '&' : '?';
    connStr = `${connStr}${separator}options=-c%20pool_mode%3D${poolMode}`;
  }
  poolConfig = { connectionString: connStr, ssl: sslConfig };
} else {
  poolConfig = {
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT, 10),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: sslConfig,
  };
  // Add pool mode for PgBouncer compatibility
  if (poolMode) {
    poolConfig.options = `-c pool_mode=${poolMode}`;
  }
}

// Extract individual connection params for psql/pg_restore
const dbHost = process.env.POSTGRES_HOST;
const dbPort = process.env.POSTGRES_PORT;
const dbName = process.env.POSTGRES_DB;
const dbUser = process.env.POSTGRES_USER;
const dbPassword = process.env.POSTGRES_PASSWORD;

const pool = new Pool(poolConfig);

/**
 * Check if pg_restore is available
 */
function checkPgRestore() {
  try {
    execSync('pg_restore --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if psql is available
 */
function checkPsql() {
  try {
    execSync('psql --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file info
 */
function getFileInfo(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  const stats = fs.statSync(filePath);
  const sizeKB = (stats.size / 1024).toFixed(2);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  let format;
  if (basename.endsWith('.sql.gz')) {
    format = 'sql-gzip';
  } else if (ext === '.sql') {
    format = 'sql';
  } else if (ext === '.dump' || ext === '.backup') {
    format = 'custom';
  } else {
    format = 'unknown';
  }

  return {
    path: filePath,
    basename,
    ext,
    format,
    size: stats.size,
    sizeDisplay: stats.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`,
    modified: stats.mtime,
  };
}

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
 * Drop all tables (for --clean option)
 */
async function dropAllTables() {
  const tables = await getAllTables();

  if (tables.length === 0) {
    console.log('No existing tables to drop.');
    return;
  }

  console.log(`Dropping ${tables.length} existing table(s)...`);
  const tableList = tables.map((t) => `"${t}"`).join(', ');
  await pool.query(`DROP TABLE IF EXISTS ${tableList} CASCADE`);
  console.log('Existing tables dropped.');
}

/**
 * Detect file encoding from BOM or content
 */
function detectEncoding(buffer) {
  // Check for BOM (Byte Order Mark)
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return 'utf16le';
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return 'utf16be';
  }
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf8-bom';
  }
  return 'utf8';
}

/**
 * Convert buffer to UTF-8 string based on detected encoding
 */
function convertToUtf8(buffer) {
  const encoding = detectEncoding(buffer);
  console.log(`Detected encoding: ${encoding}`);

  if (encoding === 'utf16le') {
    // Skip BOM (2 bytes) and decode
    return buffer.slice(2).toString('utf16le');
  }
  if (encoding === 'utf16be') {
    // Skip BOM and swap bytes for Node's utf16le decoder
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let i = 2; i < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1];
      swapped[i - 1] = buffer[i];
    }
    return swapped.toString('utf16le');
  }
  if (encoding === 'utf8-bom') {
    // Skip BOM (3 bytes)
    return buffer.slice(3).toString('utf8');
  }
  return buffer.toString('utf8');
}

/**
 * Restore from plain SQL file using psql
 */
function restoreSqlFile(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    let inputFile = filePath;
    let tempFile = null;

    // Read file and handle encoding
    console.log('Reading backup file...');
    let buffer;
    if (filePath.endsWith('.gz')) {
      console.log('Decompressing gzipped file...');
      const compressed = fs.readFileSync(filePath);
      buffer = zlib.gunzipSync(compressed);
    } else {
      buffer = fs.readFileSync(filePath);
    }

    // Convert to UTF-8 if needed
    let content = convertToUtf8(buffer);

    // Normalize line endings (CRLF -> LF) to prevent psql backslash command errors
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Remove Azure/managed PostgreSQL proprietary commands that local psql doesn't understand
    const lines = content.split('\n');
    const filteredLines = lines.filter((line) => {
      const trimmed = line.trim();
      // Filter out \restrict and \unrestrict commands (Azure backup security tokens)
      if (trimmed.startsWith('\\restrict') || trimmed.startsWith('\\unrestrict')) {
        console.log('Skipping Azure security command:', trimmed.substring(0, 40) + '...');
        return false;
      }
      return true;
    });
    content = filteredLines.join('\n');

    // Replace CREATE FUNCTION with CREATE OR REPLACE FUNCTION to handle existing functions
    // This is safe and idempotent - works for both new and existing functions
    content = content.replace(/CREATE FUNCTION/gi, 'CREATE OR REPLACE FUNCTION');
    console.log('Converted CREATE FUNCTION statements to CREATE OR REPLACE FUNCTION');

    // Fix search_path - pg_dump sets it to empty which breaks unqualified references
    // Replace empty search_path with public schema
    content = content.replace(
      /SELECT pg_catalog\.set_config\('search_path', '', false\);/gi,
      "SELECT pg_catalog.set_config('search_path', 'public', false);"
    );
    console.log('Fixed search_path configuration');

    // Remove OWNER TO statements if --no-owner flag is set (for managed databases like Supabase)
    if (options.noOwner) {
      // Remove entire ALTER ... OWNER TO statements (standalone ownership changes)
      content = content.replace(/^ALTER\s+\w+\s+[^;]+\s+OWNER\s+TO\s+[^;]+;$/gim, '');
      // Remove OWNER TO clauses from CREATE statements (inline ownership)
      content = content.replace(/\s+OWNER\s+TO\s+\w+/gi, '');
      console.log('Removed OWNER TO statements');

      // Replace public.uuid_generate_v4() with gen_random_uuid() for Supabase compatibility
      // Supabase installs uuid-ossp in 'extensions' schema, but gen_random_uuid() is built-in
      content = content.replace(/public\.uuid_generate_v4\(\)/gi, 'gen_random_uuid()');
      content = content.replace(/uuid_generate_v4\(\)/gi, 'gen_random_uuid()');
      console.log('Replaced uuid_generate_v4() with gen_random_uuid()');

      // Add DROP TABLE IF EXISTS before each CREATE TABLE for clean restore
      // This handles cases where tables exist but weren't detected (different schemas, permissions)
      content = content.replace(
        /CREATE TABLE\s+((?:public\.)?)(\w+)\s*\(/gi,
        (match, schema, tableName) => {
          return `DROP TABLE IF EXISTS ${schema}${tableName} CASCADE;\nCREATE TABLE ${schema}${tableName} (`;
        }
      );
      console.log('Added DROP TABLE IF EXISTS before CREATE TABLE statements');
    }

    // Always write to temp file to ensure UTF-8 encoding
    tempFile = path.join(path.dirname(filePath), '.restore-temp.sql');
    fs.writeFileSync(tempFile, content, 'utf8');
    inputFile = tempFile;

    console.log('Restoring from SQL file using psql...');

    const args = [
      '-h', dbHost,
      '-p', dbPort,
      '-U', dbUser,
      '-d', dbName,
      '-f', inputFile,
      '-v', 'ON_ERROR_STOP=1',
    ];

    const env = { ...process.env, PGPASSWORD: dbPassword };

    const proc = spawn('psql', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';

    proc.stdout.on('data', (data) => {
      // psql outputs notices to stdout
      const msg = data.toString().trim();
      if (msg && options.verbose) {
        console.log(msg);
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      // Only print actual errors, not notices
      const msg = data.toString().trim();
      if (msg && !msg.startsWith('NOTICE:')) {
        process.stderr.write(data);
      }
    });

    proc.on('close', (code) => {
      // Clean up temp file
      if (tempFile && fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }

      if (code !== 0) {
        reject(new Error(`psql failed with code ${code}\n${stderr}`));
      } else {
        console.log('SQL restore completed.');
        resolve();
      }
    });

    proc.on('error', (err) => {
      // Clean up temp file
      if (tempFile && fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      reject(new Error(`Failed to start psql: ${err.message}`));
    });
  });
}

/**
 * Restore from custom format using pg_restore
 */
function restoreCustomFormat(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    console.log('Restoring from custom format using pg_restore...');

    const args = [
      '-h', dbHost,
      '-p', dbPort,
      '-U', dbUser,
      '-d', dbName,
      '--verbose',
    ];

    if (options.noOwner) {
      args.push('--no-owner');
    }

    args.push(filePath);

    const env = { ...process.env, PGPASSWORD: dbPassword };

    const proc = spawn('pg_restore', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      // pg_restore outputs progress to stderr, so print it
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      // pg_restore returns non-zero for warnings too, check for actual errors
      if (code !== 0 && stderr.includes('ERROR')) {
        reject(new Error(`pg_restore failed with code ${code}`));
      } else {
        console.log('\npg_restore completed.');
        resolve();
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start pg_restore: ${err.message}`));
    });
  });
}

/**
 * Restore using psql for SQL files (alternative method)
 */
function restoreWithPsql(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    console.log('Restoring from SQL file using psql...');

    const args = [
      '-h', dbHost,
      '-p', dbPort,
      '-U', dbUser,
      '-d', dbName,
      '-f', filePath,
      '--echo-errors',
    ];

    const env = { ...process.env, PGPASSWORD: dbPassword };

    const proc = spawn('psql', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';

    proc.stdout.on('data', (data) => {
      // Only print if verbose
      if (options.verbose) {
        process.stdout.write(data);
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`psql failed with code ${code}`));
      } else {
        console.log('psql restore completed.');
        resolve();
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start psql: ${err.message}`));
    });
  });
}

/**
 * Show usage help
 */
function showHelp() {
  console.log(`
Usage: node scripts/restore-db.js <backup-file> [options]

Options:
  --confirm     Required flag to actually execute the restore
  --clean       Drop existing data before restoring
  --no-owner    Ignore ownership commands in the backup

Supported formats:
  .sql          Plain SQL dump (from pg_dump --format=plain)
  .dump         Custom format (from pg_dump --format=custom)
  .sql.gz       Gzipped SQL dump

Examples:
  node scripts/restore-db.js backup.sql              # Dry run
  node scripts/restore-db.js backup.sql --confirm    # Actually restore
  node scripts/restore-db.js backup.sql --clean --confirm
  `);
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Find the backup file (first non-flag argument)
  const backupFile = args.find((arg) => !arg.startsWith('--'));
  const confirmed = args.includes('--confirm');
  const clean = args.includes('--clean');
  const noOwner = args.includes('--no-owner');
  const dryRun = !confirmed;

  console.log('ShelvesAI Database Restore Script');
  console.log('==================================\n');

  // Check for help or missing file
  if (args.includes('--help') || args.includes('-h') || !backupFile) {
    showHelp();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  // Safety check for production
  if (process.env.NODE_ENV === 'production' && confirmed) {
    console.error('ERROR: Cannot restore database in production environment.');
    console.error('Set NODE_ENV to development or remove the production safeguard.');
    process.exit(1);
  }

  // Validate backup file exists
  const absolutePath = path.isAbsolute(backupFile) ? backupFile : path.resolve(backupFile);

  if (!fs.existsSync(absolutePath)) {
    console.error(`ERROR: Backup file not found: ${absolutePath}`);
    process.exit(1);
  }

  // Get file info
  const fileInfo = getFileInfo(absolutePath);

  if (fileInfo.format === 'unknown') {
    console.error(`ERROR: Unsupported file format: ${fileInfo.ext}`);
    console.error('Supported formats: .sql, .sql.gz, .dump, .backup');
    process.exit(1);
  }

  // Check for required tools
  if (fileInfo.format === 'custom' && !checkPgRestore()) {
    console.error('ERROR: pg_restore not found in PATH.');
    console.error('Install PostgreSQL client tools to restore custom format backups.');
    process.exit(1);
  }

  if ((fileInfo.format === 'sql' || fileInfo.format === 'sql-gzip') && !checkPsql()) {
    console.error('ERROR: psql not found in PATH.');
    console.error('Install PostgreSQL client tools to restore SQL backups.');
    process.exit(1);
  }

  try {
    // Test connection
    const result = await pool.query('SELECT current_database() as db');
    console.log(`Connected to database: ${result.rows[0].db}`);

    // Show backup file info
    console.log(`\nBackup file: ${fileInfo.basename}`);
    console.log(`Format: ${fileInfo.format}`);
    console.log(`Size: ${fileInfo.sizeDisplay}`);
    console.log(`Modified: ${fileInfo.modified.toLocaleString()}`);

    // Show existing tables
    const existingTables = await getAllTables();
    console.log(`\nExisting tables in database: ${existingTables.length}`);

    if (existingTables.length > 0 && !clean) {
      console.log('\nWARNING: Database has existing tables.');
      console.log('Use --clean to drop them before restoring.');
    }

    if (dryRun) {
      console.log('\n*** DRY RUN MODE ***');
      console.log('Add --confirm flag to actually restore.');
      console.log('\nActions that would be performed:');
      if (clean) {
        console.log(`  1. Drop ${existingTables.length} existing table(s)`);
        console.log(`  2. Restore from ${fileInfo.basename}`);
      } else {
        console.log(`  1. Restore from ${fileInfo.basename}`);
      }
      await pool.end();
      return;
    }

    // Actual restore
    console.log('\n*** RESTORING DATABASE ***\n');

    // Clean if requested
    if (clean) {
      await dropAllTables();
      console.log('');
    }

    // Close pool before using external tools
    await pool.end();

    // Restore based on format
    if (fileInfo.format === 'custom') {
      await restoreCustomFormat(absolutePath, { noOwner });
    } else {
      // SQL or gzipped SQL
      await restoreSqlFile(absolutePath, { noOwner });
    }

    // Verify restore by checking table count
    console.log('\nVerifying restore...');
    const verifyPool = new Pool(poolConfig);
    try {
      const tableResult = await verifyPool.query(`
        SELECT COUNT(*) as count FROM pg_tables WHERE schemaname = 'public'
      `);
      const tableCount = parseInt(tableResult.rows[0].count, 10);

      const rowResult = await verifyPool.query(`
        SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' LIMIT 5
      `);

      console.log(`\n✓ Database restored successfully!`);
      console.log(`  Tables in public schema: ${tableCount}`);
      if (rowResult.rows.length > 0) {
        console.log('  Sample tables:', rowResult.rows.map((r) => r.tablename).join(', '));
      }
      if (tableCount === 0) {
        console.log('\n⚠ WARNING: No tables were created. Check the backup file format.');
      }
    } finally {
      await verifyPool.end();
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
