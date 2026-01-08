# Phase 1: PostgreSQL Setup

## Overview
**Goal**: Set up PostgreSQL as the production database, replacing MongoDB. Create Docker-based local development environment and define the complete schema.

**Duration**: ~6-8 hours  
**Prerequisites**: Phase 0 complete, Docker installed

---

## Tasks

### Task 1.1: Create Docker Compose Configuration
**Priority**: 🔴 Critical  
**Estimated Time**: 30 minutes

**Description**: Create docker-compose.yml for local PostgreSQL development.

**File**: `docker-compose.yml` (repository root)

**Content**:
```yaml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    container_name: shelvesai-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: shelves
      POSTGRES_PASSWORD: ${DB_PASSWORD:-localdev123}
      POSTGRES_DB: shelvesai
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./api/database/init:/docker-entrypoint-initdb.d:ro
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shelves -d shelvesai"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Optional: pgAdmin for database management
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: shelvesai-pgadmin
    restart: unless-stopped
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@local.dev
      PGADMIN_DEFAULT_PASSWORD: admin
    ports:
      - "5050:80"
    depends_on:
      - db

volumes:
  postgres_data:
```

**Steps**:
1. Create file at repository root
2. Create `.env` file with `DB_PASSWORD=your-secure-password`
3. Add `.env` to `.gitignore` (if not already)

**Acceptance Criteria**:
- [ ] docker-compose.yml created
- [ ] `docker-compose up -d db` starts PostgreSQL
- [ ] Can connect via `psql -h localhost -U shelves -d shelvesai`

---

### Task 1.2: Create Database Directory Structure
**Priority**: 🔴 Critical  
**Estimated Time**: 15 minutes

**Description**: Set up database directory with proper organization.

**Directory Structure**:
```
api/database/
├── init/                    # Docker entrypoint scripts (run on first start)
│   └── 01-schema.sql
├── migrations/              # Incremental migrations
│   └── .gitkeep
├── seeds/                   # Test/development data
│   └── .gitkeep
├── pg.js                    # Connection pool module
└── queries/                 # Reusable query functions
    └── .gitkeep
```

**Steps**:
```bash
mkdir -p api/database/init
mkdir -p api/database/migrations
mkdir -p api/database/seeds
mkdir -p api/database/queries
touch api/database/migrations/.gitkeep
touch api/database/seeds/.gitkeep
touch api/database/queries/.gitkeep
```

**Acceptance Criteria**:
- [ ] Directory structure created
- [ ] .gitkeep files in empty directories

---

### Task 1.3: Create Initial Schema
**Priority**: 🔴 Critical  
**Estimated Time**: 1 hour

**Description**: Define the complete PostgreSQL schema matching current MongoDB models.

**File**: `api/database/init/01-schema.sql`

**Content**:
```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- Fuzzy text search

-- ============================================
-- USERS
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    
    -- Profile fields
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,
    picture TEXT,
    
    -- Location
    country TEXT,
    state TEXT,
    city TEXT,
    
    -- Privacy
    is_private BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username) WHERE username IS NOT NULL;

-- ============================================
-- SHELVES
-- ============================================
CREATE TABLE shelves (
    id SERIAL PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    name TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'book', 'movie', 'game', 'music', etc.
    description TEXT,
    
    visibility TEXT DEFAULT 'private' 
        CHECK (visibility IN ('private', 'friends', 'public')),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shelves_owner ON shelves(owner_id);
CREATE INDEX idx_shelves_visibility ON shelves(visibility);
CREATE INDEX idx_shelves_type ON shelves(type);

-- ============================================
-- COLLECTABLES (Global Catalog)
-- ============================================
CREATE TABLE collectables (
    id SERIAL PRIMARY KEY,
    
    -- Fingerprints for deduplication
    fingerprint TEXT UNIQUE,
    lightweight_fingerprint TEXT,
    
    -- Core metadata
    kind TEXT NOT NULL,  -- 'book', 'movie', 'game', 'album'
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    
    -- Creators
    primary_creator TEXT,
    creators TEXT[] DEFAULT '{}',
    
    -- Publishing
    publishers TEXT[] DEFAULT '{}',
    year TEXT,
    
    -- Categorization
    tags TEXT[] DEFAULT '{}',
    
    -- External identifiers (ISBN, IMDB, IGDB, etc.)
    identifiers JSONB DEFAULT '{}',
    
    -- Images
    images JSONB DEFAULT '[]',
    cover_url TEXT,  -- Quick access to primary cover
    
    -- Source tracking
    sources JSONB DEFAULT '[]',
    external_id TEXT,  -- Primary external ID
    
    -- Fuzzy fingerprints for OCR matching
    fuzzy_fingerprints JSONB DEFAULT '[]',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_collectables_fingerprint ON collectables(fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX idx_collectables_lwf ON collectables(lightweight_fingerprint) WHERE lightweight_fingerprint IS NOT NULL;
CREATE INDEX idx_collectables_kind ON collectables(kind);
CREATE INDEX idx_collectables_title_trgm ON collectables USING GIN (title gin_trgm_ops);
CREATE INDEX idx_collectables_external_id ON collectables(external_id) WHERE external_id IS NOT NULL;

-- ============================================
-- USER MANUALS (Custom entries not in catalog)
-- ============================================
CREATE TABLE user_manuals (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
    
    name TEXT NOT NULL,
    type TEXT,
    description TEXT,
    author TEXT,
    publisher TEXT,
    format TEXT,
    year TEXT,
    tags TEXT[] DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_manuals_user ON user_manuals(user_id);
CREATE INDEX idx_user_manuals_shelf ON user_manuals(shelf_id);

-- ============================================
-- USER COLLECTIONS (Items on shelves)
-- ============================================
CREATE TABLE user_collections (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
    
    -- Link to catalog OR manual entry (one must be set)
    collectable_id INTEGER REFERENCES collectables(id) ON DELETE SET NULL,
    manual_id INTEGER REFERENCES user_manuals(id) ON DELETE SET NULL,
    
    -- User-specific metadata
    position INTEGER,
    format TEXT,
    notes TEXT,
    rating DECIMAL(2,1) CHECK (rating >= 0 AND rating <= 5),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate items on same shelf
    UNIQUE(user_id, shelf_id, collectable_id),
    
    -- Ensure either collectable or manual is set
    CONSTRAINT item_reference_check CHECK (
        (collectable_id IS NOT NULL AND manual_id IS NULL) OR
        (collectable_id IS NULL AND manual_id IS NOT NULL)
    )
);

CREATE INDEX idx_user_collections_shelf ON user_collections(shelf_id);
CREATE INDEX idx_user_collections_user ON user_collections(user_id);
CREATE INDEX idx_user_collections_collectable ON user_collections(collectable_id) WHERE collectable_id IS NOT NULL;

-- ============================================
-- FRIENDSHIPS
-- ============================================
CREATE TABLE friendships (
    id SERIAL PRIMARY KEY,
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    status TEXT DEFAULT 'pending' 
        CHECK (status IN ('pending', 'accepted', 'blocked')),
    message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate friendships
    UNIQUE(requester_id, addressee_id),
    
    -- Prevent self-friendship
    CONSTRAINT no_self_friendship CHECK (requester_id != addressee_id)
);

CREATE INDEX idx_friendships_requester ON friendships(requester_id);
CREATE INDEX idx_friendships_addressee ON friendships(addressee_id);
CREATE INDEX idx_friendships_status ON friendships(status);

-- ============================================
-- EVENT LOGS (Activity feed)
-- ============================================
CREATE TABLE event_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    shelf_id INTEGER REFERENCES shelves(id) ON DELETE SET NULL,
    
    event_type TEXT NOT NULL,
    payload JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_event_logs_user ON event_logs(user_id);
CREATE INDEX idx_event_logs_shelf ON event_logs(shelf_id);
CREATE INDEX idx_event_logs_type ON event_logs(event_type);
CREATE INDEX idx_event_logs_created ON event_logs(created_at DESC);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to tables with updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shelves_updated_at
    BEFORE UPDATE ON shelves
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_collectables_updated_at
    BEFORE UPDATE ON collectables
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_friendships_updated_at
    BEFORE UPDATE ON friendships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**Steps**:
1. Create the file
2. Review schema matches MongoDB models
3. Test by running `docker-compose up -d db`
4. Verify with `psql -h localhost -U shelves -d shelvesai -c '\dt'`

**Acceptance Criteria**:
- [ ] Schema file created
- [ ] All tables created successfully
- [ ] Indexes created
- [ ] Triggers working

---

### Task 1.4: Create PostgreSQL Connection Module
**Priority**: 🔴 Critical  
**Estimated Time**: 45 minutes

**Description**: Create the Node.js PostgreSQL connection pool module.

**File**: `api/database/pg.js`

**Content**:
```javascript
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
  const originalQuery = client.query.bind(client);
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
```

**Steps**:
1. Create the file
2. Add `pg` to package.json: `npm install pg`
3. Test connection

**Acceptance Criteria**:
- [ ] `pg` package installed
- [ ] Connection module created
- [ ] Can import and run test query

---

### Task 1.5: Add PostgreSQL Package Dependency
**Priority**: 🔴 Critical  
**Estimated Time**: 10 minutes

**Description**: Add the pg package to the API.

**Steps**:
```bash
cd api
npm install pg
npm install --save-dev @types/pg  # If using TypeScript
```

**File Changes**: `api/package.json`
```diff
  "dependencies": {
+   "pg": "^8.11.0",
    ...
  }
```

**Acceptance Criteria**:
- [ ] `pg` in dependencies
- [ ] `npm install` completes without errors

---

### Task 1.6: Create Environment Configuration
**Priority**: 🔴 Critical  
**Estimated Time**: 20 minutes

**Description**: Update .env.example with PostgreSQL configuration.

**File**: `api/.env.example`

**Content**:
```bash
# ===========================================
# DATABASE
# ===========================================
# Option 1: Connection URL (preferred for production)
# DATABASE_URL=postgresql://user:password@host:5432/database

# Option 2: Individual variables (local development)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=shelvesai
DB_USER=shelves
DB_PASSWORD=localdev123
DB_POOL_MAX=20
DB_SSL=false

# ===========================================
# AUTHENTICATION
# ===========================================
JWT_SECRET=your-very-long-secret-key-here-minimum-32-chars

# ===========================================
# GOOGLE CLOUD VISION
# ===========================================
GOOGLE_APPLICATION_CREDENTIALS=./credentials/gcp-service-account.json

# ===========================================
# OPENAI (for catalog enrichment)
# ===========================================
OPENAI_API_KEY=sk-...
OPENAI_TEXT_MODEL=gpt-4o-mini

# ===========================================
# CATALOG APIs
# ===========================================
TMDB_API_KEY=your-tmdb-api-key

# IGDB (via Twitch)
IGDB_CLIENT_ID=your-twitch-client-id
IGDB_CLIENT_SECRET=your-twitch-client-secret

# ===========================================
# FEATURE FLAGS
# ===========================================
ENABLE_SHELF_VISION_SECOND_PASS=true

# ===========================================
# SERVER
# ===========================================
PORT=5001
NODE_ENV=development
```

**Steps**:
1. Create/update `api/.env.example`
2. Copy to `api/.env` and fill in values
3. Ensure `.env` is in `.gitignore`

**Acceptance Criteria**:
- [ ] `.env.example` created with all variables
- [ ] `.env` created locally (not committed)
- [ ] Server reads environment variables correctly

---

### Task 1.7: Test Database Connection
**Priority**: 🔴 Critical  
**Estimated Time**: 30 minutes

**Description**: Verify the complete PostgreSQL setup works end-to-end.

**Steps**:
1. Start PostgreSQL
   ```bash
   docker-compose up -d db
   ```

2. Wait for healthy status
   ```bash
   docker-compose ps  # Should show "healthy"
   ```

3. Verify tables exist
   ```bash
   docker-compose exec db psql -U shelves -d shelvesai -c '\dt'
   ```

4. Test from Node.js
   Create `api/database/test-connection.js`:
   ```javascript
   require('dotenv').config();
   const { query } = require('./pg');
   
   async function test() {
     try {
       const result = await query('SELECT NOW() as time, current_database() as db');
       console.log('Connection successful:', result.rows[0]);
       
       const tables = await query(`
         SELECT table_name 
         FROM information_schema.tables 
         WHERE table_schema = 'public'
         ORDER BY table_name
       `);
       console.log('Tables:', tables.rows.map(r => r.table_name));
       
       process.exit(0);
     } catch (err) {
       console.error('Connection failed:', err);
       process.exit(1);
     }
   }
   
   test();
   ```

5. Run test
   ```bash
   node api/database/test-connection.js
   ```

**Acceptance Criteria**:
- [ ] PostgreSQL container running
- [ ] Container health check passes
- [ ] All 7 tables created
- [ ] Node.js can connect and query
- [ ] Tables list matches schema

---

### Task 1.8: Create Query Helper Functions
**Priority**: 🟡 Medium  
**Estimated Time**: 1 hour

**Description**: Create reusable query helper functions for common operations.

**File**: `api/database/queries/users.js`

**Content**:
```javascript
const { query, transaction } = require('../pg');

/**
 * Find user by email
 */
async function findByEmail(email) {
  const result = await query(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  return result.rows[0] || null;
}

/**
 * Find user by ID
 */
async function findById(id) {
  const result = await query(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Find user by username
 */
async function findByUsername(username) {
  const result = await query(
    'SELECT * FROM users WHERE username = $1',
    [username.toLowerCase()]
  );
  return result.rows[0] || null;
}

/**
 * Create new user
 */
async function create({ email, passwordHash, username }) {
  const result = await query(
    `INSERT INTO users (email, password_hash, username)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [email.toLowerCase(), passwordHash, username?.toLowerCase() || null]
  );
  return result.rows[0];
}

/**
 * Update user profile
 */
async function updateProfile(id, updates) {
  const fields = [];
  const values = [];
  let paramIndex = 1;
  
  const allowedFields = [
    'username', 'first_name', 'last_name', 'phone_number',
    'picture', 'country', 'state', 'city', 'is_private'
  ];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }
  
  if (fields.length === 0) return findById(id);
  
  values.push(id);
  const result = await query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return result.rows[0];
}

module.exports = {
  findByEmail,
  findById,
  findByUsername,
  create,
  updateProfile,
};
```

**Additional Query Files to Create**:
- `api/database/queries/shelves.js`
- `api/database/queries/collectables.js`
- `api/database/queries/friendships.js`

**Acceptance Criteria**:
- [ ] users.js queries created
- [ ] Query functions are parameterized (prevent SQL injection)
- [ ] Basic CRUD operations covered

---

## Phase 1 Completion Checklist

Before moving to Phase 2, verify:

- [ ] docker-compose.yml created
- [ ] Database directory structure created
- [ ] Schema SQL file created
- [ ] `pg.js` connection module created
- [ ] `pg` package installed
- [ ] `.env.example` updated
- [ ] PostgreSQL container starts and is healthy
- [ ] All 7 tables created
- [ ] Node.js can connect
- [ ] Query helpers created
- [ ] Test connection script passes
