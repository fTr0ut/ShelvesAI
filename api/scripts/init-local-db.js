#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const envLocalPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath, override: true });
}

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.USE_LOCAL_DB = process.env.USE_LOCAL_DB || '1';

const { URL } = require('url');
const { Pool } = require('pg');
const logger = require('../logger');
const knexfile = require('../knexfile');

const schemaPath = path.join(__dirname, '../database/init/01-schema.sql');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function getDevelopmentConnectionConfig() {
  const config = knexfile?.development?.connection;

  if (!config) {
    throw new Error('Missing development database connection in knexfile.js');
  }

  return typeof config === 'string' ? { connectionString: config } : { ...config };
}

function describeConnection(connectionConfig) {
  if (connectionConfig.connectionString) {
    const parsed = new URL(connectionConfig.connectionString);

    return {
      host: parsed.hostname || 'localhost',
      port: parsed.port ? parseInt(parsed.port, 10) : 5432,
      database: parsed.pathname.replace(/^\//, '') || 'postgres',
      user: decodeURIComponent(parsed.username || ''),
    };
  }

  return {
    host: connectionConfig.host || 'localhost',
    port: parseInt(connectionConfig.port || '5432', 10),
    database: connectionConfig.database || 'postgres',
    user: connectionConfig.user || '',
  };
}

function isLocalConnection(connectionInfo) {
  return LOCAL_HOSTS.has(String(connectionInfo.host || '').toLowerCase());
}

function loadSchemaSql() {
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }

  return fs.readFileSync(schemaPath, 'utf8');
}

async function checkConnection(pool) {
  const result = await pool.query(`
    SELECT
      current_database() AS database_name,
      current_user AS user_name,
      NOW() AS server_time
  `);

  return result.rows[0];
}

async function recreatePublicSchema(pool) {
  logger.warn('Dropping public schema with CASCADE...');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');

  logger.info('Recreating public schema...');
  await pool.query('CREATE SCHEMA public');
  await pool.query('GRANT ALL ON SCHEMA public TO PUBLIC');
  await pool.query(`COMMENT ON SCHEMA public IS 'standard public schema'`);
}

async function applySchemaSnapshot(pool, schemaSql) {
  logger.info('Applying schema snapshot...');
  await pool.query(schemaSql);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const checkOnly = args.has('--check');
  const connectionConfig = getDevelopmentConnectionConfig();
  const connectionInfo = describeConnection(connectionConfig);

  if (!isLocalConnection(connectionInfo)) {
    throw new Error(
      `Refusing to reset non-local database host "${connectionInfo.host}". Update api/.env.local to point at localhost.`,
    );
  }

  const schemaSql = loadSchemaSql();

  logger.info('ShelvesAI Local Postgres Reset');
  logger.info('==============================');
  logger.info(`Target: ${connectionInfo.user || '(default user)'}@${connectionInfo.host}:${connectionInfo.port}/${connectionInfo.database}`);
  logger.info(`Schema source: ${schemaPath}`);

  const pool = new Pool(connectionConfig);

  try {
    const status = await checkConnection(pool);
    logger.info(`Connected as ${status.user_name} to ${status.database_name}`);
    logger.info(`Server time: ${status.server_time}`);

    if (checkOnly) {
      logger.info('Check complete. No changes applied.');
      return;
    }

    await recreatePublicSchema(pool);
    await applySchemaSnapshot(pool, schemaSql);
  } finally {
    await pool.end();
  }
  logger.info('Local database reset complete.');
}

main().catch((err) => {
  logger.error('Local database reset failed:', err.message);
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    logger.error(err.stack);
  }
  process.exit(1);
});
