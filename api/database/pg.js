/**
 * PostgreSQL Connection Pool
 *
 * This module provides a shared connection pool for database operations.
 * Schema management is handled by Knex migrations - run `npx knex migrate:latest`
 */

const { Pool } = require('pg');

// Build connection config from environment variables
// Supports DATABASE_URL / POSTGRES_URL or individual POSTGRES_* variables
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sslEnabled = process.env.POSTGRES_SSL === 'true' || process.env.POSTGRES_SSL === 'require';
const sslConfig = sslEnabled ? { rejectUnauthorized: false } : false;
const poolMax = process.env.POSTGRES_POOL_MAX ? parseInt(process.env.POSTGRES_POOL_MAX, 10) : 10;
const idleTimeoutMillis = 30000;
const connectionTimeoutMillis = 5000;
const slowQueryThresholdMs = process.env.SLOW_QUERY_MS ? parseInt(process.env.SLOW_QUERY_MS, 10) : 250;

// Validate required database configuration
if (!connectionString && !process.env.POSTGRES_PASSWORD) {
  console.error('FATAL: Database configuration missing.');
  console.error('Set DATABASE_URL or POSTGRES_HOST/POSTGRES_PASSWORD environment variables.');
  process.exit(1);
}

const poolConfig = connectionString
  ? {
      connectionString,
      ssl: sslConfig,
      max: poolMax,
      idleTimeoutMillis,
      connectionTimeoutMillis,
      keepAlive: true,
    }
  : {
      host: process.env.POSTGRES_HOST,
      port: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : 5432,
      database: process.env.POSTGRES_NAME || process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      max: poolMax,
      idleTimeoutMillis,
      connectionTimeoutMillis,
      ssl: sslConfig,
      keepAlive: true,
    };

const pool = new Pool(poolConfig);

// Log connection errors
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

// Test connection on startup
pool.query('SELECT NOW()')
  .then(() => {
    console.log('PostgreSQL connected');
  })
  .catch((err) => {
    console.error('PostgreSQL connection error:', err.message);
  });

/**
 * Execute a query with parameters
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    if (process.env.NODE_ENV !== 'production' && duration > slowQueryThresholdMs) {
      console.log('Slow query:', { text: text.substring(0, 100), duration, rows: result.rowCount });
    }

    return result;
  } catch (err) {
    console.error('Query error:', { text: text.substring(0, 100), error: err.message });
    throw err;
  }
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<PoolClient>}
 */
async function getClient() {
  const client = await pool.connect();
  const originalRelease = client.release.bind(client);

  // Track if client has been released
  let released = false;

  // Monkey-patch release to prevent double-release
  client.release = () => {
    if (released) {
      console.warn('Client already released');
      return;
    }
    released = true;
    return originalRelease();
  };

  return client;
}

/**
 * Run a function within a transaction
 * @param {Function} fn - Function receiving client
 * @returns {Promise<any>}
 */
async function transaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Execute a query with RLS user context
 * Sets the app.current_user_id session variable for Row Level Security policies
 * @param {string} userId - Current user's UUID
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<QueryResult>}
 */
async function queryWithContext(userId, text, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) {
      await client.query('SET LOCAL "app.current_user_id" = $1', [userId]);
    }
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run a function within a transaction with RLS user context
 * Sets the app.current_user_id session variable for Row Level Security policies
 * @param {string} userId - Current user's UUID
 * @param {Function} fn - Function receiving client
 * @returns {Promise<any>}
 */
async function transactionWithContext(userId, fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (userId) {
      await client.query('SET LOCAL "app.current_user_id" = $1', [userId]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully close the pool
 * @returns {Promise<void>}
 */
async function close() {
  await pool.end();
  console.log('PostgreSQL pool closed');
}

module.exports = {
  pool,
  query,
  getClient,
  transaction,
  queryWithContext,
  transactionWithContext,
  close,
};
