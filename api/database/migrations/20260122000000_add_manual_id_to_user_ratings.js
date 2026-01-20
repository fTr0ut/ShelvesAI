/**
 * Migration: Add manual_id to user_ratings table
 * Allows rating items from both collectables and user_manuals tables
 */

exports.up = async function (knex) {
    // 1. Add manual_id column (nullable)
    const hasManualId = await knex.schema.hasColumn('user_ratings', 'manual_id');
    if (!hasManualId) {
        await knex.schema.alterTable('user_ratings', (table) => {
            table.integer('manual_id').references('id').inTable('user_manuals').onDelete('CASCADE');
            table.index('manual_id');
        });
    }

    // 2. Make collectable_id nullable
    // Note: We need to drop and recreate the constraint
    await knex.raw(`
        ALTER TABLE user_ratings 
        ALTER COLUMN collectable_id DROP NOT NULL
    `);

    // 3. Add unique constraint for manual ratings
    await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ratings_manual 
        ON user_ratings(user_id, manual_id) 
        WHERE manual_id IS NOT NULL
    `);

    // 4. Add check constraint: exactly one of collectable_id or manual_id must be set
    await knex.raw(`
        ALTER TABLE user_ratings
        ADD CONSTRAINT item_reference_check CHECK (
            (collectable_id IS NOT NULL AND manual_id IS NULL) OR
            (collectable_id IS NULL AND manual_id IS NOT NULL)
        )
    `);
};

exports.down = async function (knex) {
    // Remove check constraint
    await knex.raw(`
        ALTER TABLE user_ratings
        DROP CONSTRAINT IF EXISTS item_reference_check
    `);

    // Remove unique index
    await knex.raw(`DROP INDEX IF EXISTS idx_user_ratings_manual`);

    // Delete any manual ratings before making collectable_id NOT NULL
    await knex.raw(`DELETE FROM user_ratings WHERE collectable_id IS NULL`);

    // Make collectable_id NOT NULL again
    await knex.raw(`
        ALTER TABLE user_ratings 
        ALTER COLUMN collectable_id SET NOT NULL
    `);

    // Remove manual_id column
    await knex.schema.alterTable('user_ratings', (table) => {
        table.dropColumn('manual_id');
    });
};
