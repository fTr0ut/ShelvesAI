const { Pool } = require('pg');

// Parse DATABASE_URL or use individual env vars
const connectionString = process.env.DATABASE_URL;

const poolConfig = connectionString
  ? { connectionString, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'shelvesai',
      user: process.env.DB_USER || 'shelves',
      password: process.env.DB_PASSWORD || 'localdev123',
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

const pool = new Pool(poolConfig);

// Log connection errors
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

// Test connection on startup
pool.query('SELECT NOW()')
  .then(() => console.log('PostgreSQL connected'))
  .catch((err) => console.error('PostgreSQL connection error:', err));

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
    
    if (process.env.NODE_ENV !== 'production' && duration > 100) {
      console.log('Slow query:', { text, duration, rows: result.rowCount });
    }
    
    return result;
  } catch (err) {
    console.error('Query error:', { text, error: err.message });
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

module.exports = {
  pool,
  query,
  getClient,
  transaction,
};
