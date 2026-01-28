/**
 * Migration: Add manual_id to user_favorites
 */
exports.up = function (knex) {
    return knex.schema.alterTable('user_favorites', function (table) {
        // Add manual_id column
        table.integer('manual_id').unsigned().references('id').inTable('user_manuals').onDelete('CASCADE');

        // Make collectable_id nullable
        table.integer('collectable_id').nullable().alter();
    }).then(() => {
        return knex.raw(`
            -- Drop existing unique constraint (try common names)
            ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS user_favorites_user_id_collectable_id_key;
            ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS user_favorites_user_id_collectable_id_unique; -- Just in case
            
            -- Add check constraint to ensure exactly one ID is set
            ALTER TABLE user_favorites 
            ADD CONSTRAINT favourites_item_check 
            CHECK (
                (collectable_id IS NOT NULL AND manual_id IS NULL) OR 
                (collectable_id IS NULL AND manual_id IS NOT NULL)
            );

            -- Add partial unique indexes
            CREATE UNIQUE INDEX idx_user_favorites_unique_collectable 
            ON user_favorites (user_id, collectable_id) 
            WHERE collectable_id IS NOT NULL;

            CREATE UNIQUE INDEX idx_user_favorites_unique_manual 
            ON user_favorites (user_id, manual_id) 
            WHERE manual_id IS NOT NULL;
            
            -- Add index for manual_id lookups
            CREATE INDEX idx_user_favorites_manual 
            ON user_favorites (manual_id);
        `);
    });
};

exports.down = function (knex) {
    return knex.raw(`
        -- Remove manual favorites to allow rollback (lossy)
        DELETE FROM user_favorites WHERE manual_id IS NOT NULL;
        
        DROP INDEX IF EXISTS idx_user_favorites_unique_collectable;
        DROP INDEX IF EXISTS idx_user_favorites_unique_manual;
        DROP INDEX IF EXISTS idx_user_favorites_manual;
        
        ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS favourites_item_check;
        
        -- Try to restore unique constraint (might fail if data is bad, but we deleted manual_ids)
        -- We won't strictly enforce it here as it requires exact index recreation which is tricky in raw.
        -- We'll let the schema builder handle it below.
    `).then(() => {
        return knex.schema.alterTable('user_favorites', function (table) {
            table.dropColumn('manual_id');
            table.integer('collectable_id').notNullable().alter();
            table.unique(['user_id', 'collectable_id']);
        });
    });
};
