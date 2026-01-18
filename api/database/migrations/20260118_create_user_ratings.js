/**
 * Migration: Create user_ratings table and migrate existing ratings
 */
const { query, transaction } = require('../pg');

async function migrate() {
    console.log('Starting migration: user_ratings');

    await transaction(async (client) => {
        // 1. Create table
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_ratings (
                id SERIAL PRIMARY KEY,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                collectable_id INTEGER NOT NULL REFERENCES collectables(id) ON DELETE CASCADE,
                rating DECIMAL(2,1) CHECK (rating >= 0 AND rating <= 5),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(user_id, collectable_id)
            );
        `);
        console.log('Created user_ratings table');

        // 2. Add indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_user_ratings_user ON user_ratings(user_id);
            CREATE INDEX IF NOT EXISTS idx_user_ratings_collectable ON user_ratings(collectable_id);
        `);
        console.log('Created indexes');

        // 3. Migrate existing ratings from user_collections
        // Only migrate entries that have a valid rating and link to a collectable (not manual-only)
        const { rows } = await client.query(`
            INSERT INTO user_ratings (user_id, collectable_id, rating, created_at, updated_at)
            SELECT DISTINCT user_id, collectable_id, rating, created_at, NOW()
            FROM user_collections
            WHERE rating IS NOT NULL 
              AND collectable_id IS NOT NULL
            ON CONFLICT (user_id, collectable_id) DO UPDATE
            SET rating = EXCLUDED.rating, updated_at = NOW();
        `);
        console.log(`Migrated ${rows.length} existing ratings`);

        // 4. Create trigger for updated_at
        await client.query(`
            DROP TRIGGER IF EXISTS update_user_ratings_updated_at ON user_ratings;
            CREATE TRIGGER update_user_ratings_updated_at
                BEFORE UPDATE ON user_ratings
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `);
        console.log('Created updated_at trigger');
    });

    console.log('Migration completed successfully');
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
