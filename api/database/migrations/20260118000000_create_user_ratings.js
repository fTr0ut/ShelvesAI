/**
 * Migration: Create user_ratings table and migrate existing ratings
 * This decouples ratings from user_collections, allowing users to rate any collectable
 */

exports.up = async function (knex) {
    // 1. Create user_ratings table
    const hasUserRatings = await knex.schema.hasTable('user_ratings');
    if (!hasUserRatings) {
        await knex.schema.createTable('user_ratings', (table) => {
            table.increments('id').primary();
            table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
            table.integer('collectable_id').notNullable().references('id').inTable('collectables').onDelete('CASCADE');
            table.decimal('rating', 2, 1).checkBetween([0, 5]);
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('updated_at').defaultTo(knex.fn.now());

            table.unique(['user_id', 'collectable_id']);
            table.index('user_id');
            table.index('collectable_id');
        });
    }

    // 2. Migrate existing ratings from user_collections
    // Only migrate entries that have a valid rating and link to a collectable
    await knex.raw(`
        INSERT INTO user_ratings (user_id, collectable_id, rating, created_at, updated_at)
        SELECT DISTINCT user_id, collectable_id, rating, created_at, NOW()
        FROM user_collections
        WHERE rating IS NOT NULL 
          AND collectable_id IS NOT NULL
        ON CONFLICT (user_id, collectable_id) DO UPDATE
        SET rating = EXCLUDED.rating, updated_at = NOW()
    `);

    // 3. Create trigger for updated_at (if the function exists)
    await knex.raw(`
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
                DROP TRIGGER IF EXISTS update_user_ratings_updated_at ON user_ratings;
                CREATE TRIGGER update_user_ratings_updated_at
                    BEFORE UPDATE ON user_ratings
                    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
            END IF;
        END $$;
    `);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('user_ratings');
};
