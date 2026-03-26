/**
 * Migration: Create user_market_value_estimates table
 * Allows users to provide their own market value estimate for collectables and manual items
 */

exports.up = async function (knex) {
    const hasTable = await knex.schema.hasTable('user_market_value_estimates');
    if (!hasTable) {
        await knex.schema.createTable('user_market_value_estimates', (table) => {
            table.increments('id').primary();
            table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
            table.integer('collectable_id').nullable().references('id').inTable('collectables').onDelete('CASCADE');
            table.integer('manual_id').nullable().references('id').inTable('user_manuals').onDelete('CASCADE');
            table.text('estimate_value').notNullable();
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('updated_at').defaultTo(knex.fn.now());

            table.index('user_id');
            table.index('collectable_id');
            table.index('manual_id');
        });

        // Partial unique indexes (one of collectable_id or manual_id must be set)
        await knex.raw(`
            CREATE UNIQUE INDEX uq_user_estimate_collectable
                ON user_market_value_estimates (user_id, collectable_id)
                WHERE collectable_id IS NOT NULL;
        `);
        await knex.raw(`
            CREATE UNIQUE INDEX uq_user_estimate_manual
                ON user_market_value_estimates (user_id, manual_id)
                WHERE manual_id IS NOT NULL;
        `);

        // CHECK: exactly one of collectable_id or manual_id must be non-null
        await knex.raw(`
            ALTER TABLE user_market_value_estimates
                ADD CONSTRAINT chk_estimate_one_target
                CHECK (
                    (collectable_id IS NOT NULL AND manual_id IS NULL)
                    OR (collectable_id IS NULL AND manual_id IS NOT NULL)
                );
        `);
    }

    // Create updated_at trigger
    await knex.raw(`
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
                DROP TRIGGER IF EXISTS update_user_market_value_estimates_updated_at ON user_market_value_estimates;
                CREATE TRIGGER update_user_market_value_estimates_updated_at
                    BEFORE UPDATE ON user_market_value_estimates
                    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
            END IF;
        END $$;
    `);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('user_market_value_estimates');
};
