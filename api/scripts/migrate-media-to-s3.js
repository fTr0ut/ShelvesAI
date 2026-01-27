#!/usr/bin/env node
/**
 * Migration script: Migrate existing media files from local filesystem to S3
 *
 * Usage:
 *   node migrate-media-to-s3.js [options]
 *
 * Options:
 *   --dry-run     Show what would be migrated without uploading
 *   --batch=N     Process N files at a time (default: 10)
 *   --table=NAME  Migrate only specific table: 'media', 'profile_media', or 'all' (default: 'all')
 *   --skip=N      Skip first N records (for resuming)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs/promises');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BATCH_SIZE = parseInt(args.find(a => a.startsWith('--batch='))?.split('=')[1] || '10', 10);
const TABLE_FILTER = args.find(a => a.startsWith('--table='))?.split('=')[1] || 'all';
const SKIP_COUNT = parseInt(args.find(a => a.startsWith('--skip='))?.split('=')[1] || '0', 10);

// Database configuration
const connectionString = process.env.DATABASE_URL;
const poolConfig = connectionString
  ? { connectionString, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'shelvesai',
      user: process.env.DB_USER || 'shelves',
      password: process.env.DB_PASSWORD || 'localdev123',
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

const pool = new Pool(poolConfig);

// S3 configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const S3_BUCKET = process.env.S3_BUCKET_NAME;

// Local cache directory
const API_ROOT = path.resolve(__dirname, '..');
const RAW_CACHE_ROOT = process.env.MEDIA_CACHE_DIR || process.env.COVER_CACHE_DIR || './cache';
const CACHE_ROOT = path.isAbsolute(RAW_CACHE_ROOT)
  ? RAW_CACHE_ROOT
  : path.resolve(API_ROOT, RAW_CACHE_ROOT);

// Statistics
const stats = {
  total: 0,
  migrated: 0,
  skipped: 0,
  alreadyExists: 0,
  notFound: 0,
  errors: 0,
};

/**
 * Convert local_path to absolute filesystem path
 */
function toAbsolutePath(localPath) {
  const parts = String(localPath || '').split(/[/\\]/).filter(Boolean);
  return path.join(CACHE_ROOT, ...parts);
}

/**
 * Normalize path to use forward slashes (S3 standard)
 */
function normalizeKey(localPath) {
  return String(localPath || '').replace(/\\/g, '/');
}

/**
 * Check if object exists in S3
 */
async function s3ObjectExists(key) {
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

/**
 * Upload file to S3
 */
async function uploadToS3(localPath, buffer, contentType) {
  const key = normalizeKey(localPath);

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return key;
}

/**
 * Guess content type from file extension
 */
function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return types[ext] || 'image/jpeg';
}

/**
 * Migrate a single media record
 */
async function migrateRecord(record, tableName) {
  const { id, local_path, content_type } = record;

  if (!local_path) {
    stats.skipped++;
    return { status: 'skipped', reason: 'no local_path' };
  }

  const s3Key = normalizeKey(local_path);

  // Check if already exists in S3
  try {
    if (await s3ObjectExists(s3Key)) {
      stats.alreadyExists++;
      return { status: 'exists', key: s3Key };
    }
  } catch (err) {
    // Ignore check errors, proceed with upload
  }

  // Read local file
  const absolutePath = toAbsolutePath(local_path);
  let buffer;
  try {
    buffer = await fs.readFile(absolutePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      stats.notFound++;
      return { status: 'not_found', path: absolutePath };
    }
    throw err;
  }

  if (buffer.length === 0) {
    stats.skipped++;
    return { status: 'skipped', reason: 'empty file' };
  }

  // Upload to S3
  if (DRY_RUN) {
    stats.migrated++;
    return { status: 'dry_run', key: s3Key, size: buffer.length };
  }

  const finalContentType = content_type || guessContentType(local_path);
  await uploadToS3(local_path, buffer, finalContentType);
  stats.migrated++;

  return { status: 'migrated', key: s3Key, size: buffer.length };
}

/**
 * Migrate records from a table
 */
async function migrateTable(tableName) {
  console.log(`\n--- Migrating ${tableName} ---`);

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM ${tableName} WHERE local_path IS NOT NULL`
  );
  const totalCount = parseInt(countResult.rows[0].count, 10);
  console.log(`Found ${totalCount} records with local_path`);

  if (totalCount === 0) {
    return;
  }

  let offset = SKIP_COUNT;
  let processed = 0;

  while (offset < totalCount) {
    const result = await pool.query(
      `SELECT id, local_path, content_type FROM ${tableName}
       WHERE local_path IS NOT NULL
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );

    if (result.rows.length === 0) break;

    for (const record of result.rows) {
      stats.total++;
      processed++;

      try {
        const migrationResult = await migrateRecord(record, tableName);
        const progress = `[${processed}/${totalCount}]`;

        if (migrationResult.status === 'migrated' || migrationResult.status === 'dry_run') {
          console.log(`${progress} Migrated: ${migrationResult.key} (${migrationResult.size} bytes)`);
        } else if (migrationResult.status === 'exists') {
          console.log(`${progress} Already in S3: ${migrationResult.key}`);
        } else if (migrationResult.status === 'not_found') {
          console.log(`${progress} File not found: ${migrationResult.path}`);
        } else if (migrationResult.status === 'skipped') {
          console.log(`${progress} Skipped: ${migrationResult.reason}`);
        }
      } catch (err) {
        stats.errors++;
        console.error(`[${processed}/${totalCount}] Error migrating record ${record.id}:`, err.message);
      }
    }

    offset += BATCH_SIZE;
  }
}

/**
 * Main migration function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('S3 Media Migration Script');
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('\n** DRY RUN MODE - No files will be uploaded **\n');
  }

  // Validate S3 configuration
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('ERROR: AWS credentials not configured.');
    console.error('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.');
    process.exit(1);
  }

  if (!S3_BUCKET) {
    console.error('ERROR: S3_BUCKET_NAME environment variable not set.');
    process.exit(1);
  }

  console.log(`S3 Bucket: ${S3_BUCKET}`);
  console.log(`Local cache: ${CACHE_ROOT}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Skip count: ${SKIP_COUNT}`);
  console.log(`Table filter: ${TABLE_FILTER}`);

  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('Database connection: OK');

    // Migrate tables based on filter
    if (TABLE_FILTER === 'all' || TABLE_FILTER === 'media') {
      await migrateTable('media');
    }

    if (TABLE_FILTER === 'all' || TABLE_FILTER === 'profile_media') {
      await migrateTable('profile_media');
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('Migration Summary');
    console.log('='.repeat(60));
    console.log(`Total records processed: ${stats.total}`);
    console.log(`Successfully migrated:   ${stats.migrated}`);
    console.log(`Already in S3:           ${stats.alreadyExists}`);
    console.log(`File not found locally:  ${stats.notFound}`);
    console.log(`Skipped (no path/empty): ${stats.skipped}`);
    console.log(`Errors:                  ${stats.errors}`);

    if (DRY_RUN) {
      console.log('\n** DRY RUN COMPLETE - No files were uploaded **');
      console.log('Run without --dry-run to perform actual migration.');
    }

  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
