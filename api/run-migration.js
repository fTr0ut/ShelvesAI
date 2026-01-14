require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'shelvesai',
  user: process.env.DB_USER || 'shelves',
  password: process.env.DB_PASSWORD || 'localdev123',
});

async function runMigration() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('1. Adding bio column to users...');
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT`);

    console.log('2. Creating profile_media table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS profile_media (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind VARCHAR(50) NOT NULL DEFAULT 'avatar',
        source_url TEXT,
        local_path TEXT,
        content_type VARCHAR(100),
        size_bytes INTEGER,
        checksum VARCHAR(64),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_profile_media_user ON profile_media(user_id)`);

    console.log('3. Adding profile_media_id to users...');
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_media_id INTEGER REFERENCES profile_media(id) ON DELETE SET NULL`);

    console.log('4. Creating wishlists table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS wishlists (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        visibility VARCHAR(20) DEFAULT 'private',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wishlists_user ON wishlists(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wishlists_visibility ON wishlists(visibility)`);

    console.log('5. Creating wishlist_items table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS wishlist_items (
        id SERIAL PRIMARY KEY,
        wishlist_id INTEGER NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
        collectable_id INTEGER REFERENCES collectables(id) ON DELETE SET NULL,
        manual_text TEXT,
        notes TEXT,
        priority INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wishlist_items_wishlist ON wishlist_items(wishlist_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wishlist_items_collectable ON wishlist_items(collectable_id)`);

    console.log('6. Adding cover_image_url, cover_image_source, attribution to collectables...');
    await client.query(`ALTER TABLE collectables ADD COLUMN IF NOT EXISTS cover_image_url TEXT`);
    await client.query(`ALTER TABLE collectables ADD COLUMN IF NOT EXISTS cover_image_source TEXT`);
    await client.query(`ALTER TABLE collectables ADD COLUMN IF NOT EXISTS attribution JSONB`);

    console.log('7. Backfilling cover fields from existing media...');
    await client.query(`
            UPDATE collectables c
            SET 
                cover_image_url = m.local_path,
                cover_image_source = 'local'
            FROM media m
            WHERE c.cover_media_id = m.id
              AND m.local_path IS NOT NULL
              AND c.cover_image_url IS NULL
        `);

    console.log('8. Backfilling cover fields from cover_url...');
    await client.query(`
            UPDATE collectables
            SET 
                cover_image_url = cover_url,
                cover_image_source = 'external'
            WHERE cover_image_url IS NULL
              AND cover_url IS NOT NULL
        `);

    await client.query('COMMIT');
    console.log('Migration completed successfully!');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
