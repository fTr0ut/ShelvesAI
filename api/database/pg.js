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
  .then(async () => {
    console.log('PostgreSQL connected');
    try {
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE');
    } catch (err) {
      console.warn('Failed to ensure users.is_premium column:', err.message);
    }
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS media (
          id SERIAL PRIMARY KEY,
          collectable_id INTEGER NOT NULL REFERENCES collectables(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          variant TEXT,
          provider TEXT,
          source_url TEXT NOT NULL,
          local_path TEXT,
          content_type TEXT,
          size_bytes INTEGER,
          checksum TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,
      );
      await pool.query('ALTER TABLE media ADD COLUMN IF NOT EXISTS local_path TEXT');
      await pool.query('ALTER TABLE media ADD COLUMN IF NOT EXISTS content_type TEXT');
      await pool.query('ALTER TABLE media ADD COLUMN IF NOT EXISTS size_bytes INTEGER');
      await pool.query('ALTER TABLE media ADD COLUMN IF NOT EXISTS checksum TEXT');
      await pool.query('ALTER TABLE collectables ADD COLUMN IF NOT EXISTS cover_media_id INTEGER');
      await pool.query(
        `DO $$
         BEGIN
           IF EXISTS (
             SELECT 1
             FROM information_schema.columns
             WHERE table_name = 'media' AND column_name = 'bytes'
           ) THEN
             ALTER TABLE media ALTER COLUMN bytes DROP NOT NULL;
           END IF;
         END $$`,
      );
      await pool.query(
        `DO $$
         BEGIN
           IF NOT EXISTS (
             SELECT 1
             FROM pg_constraint
             WHERE conname = 'collectables_cover_media_id_fkey'
           ) THEN
             ALTER TABLE collectables
               ADD CONSTRAINT collectables_cover_media_id_fkey
               FOREIGN KEY (cover_media_id)
               REFERENCES media(id)
               ON DELETE SET NULL;
           END IF;
         END $$`,
      );
      await pool.query('CREATE INDEX IF NOT EXISTS idx_media_collectable ON media(collectable_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_media_kind ON media(kind)');
      await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_media_collectable_url ON media(collectable_id, source_url)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_collectables_cover_media ON collectables(cover_media_id)');
    } catch (err) {
      console.warn('Failed to ensure media tables:', err.message);
    }
  })
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
