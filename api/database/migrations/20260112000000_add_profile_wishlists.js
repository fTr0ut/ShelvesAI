/**
 * Migration: Add profile pages support
 * - Add bio column to users
 * - Create profile_media table for user avatars
 * - Add profile_media_id FK to users
 * - Create wishlists table
 * - Create wishlist_items table
 */

exports.up = async function (knex) {
    // 1. Add bio column to users
    const hasBio = await knex.schema.hasColumn('users', 'bio');
    if (!hasBio) {
        await knex.schema.alterTable('users', (table) => {
            table.text('bio');
        });
    }

    // 2. Create profile_media table
    const hasProfileMedia = await knex.schema.hasTable('profile_media');
    if (!hasProfileMedia) {
        await knex.schema.createTable('profile_media', (table) => {
            table.increments('id').primary();
            table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
            table.string('kind', 50).notNullable().defaultTo('avatar');
            table.text('source_url');
            table.text('local_path');
            table.string('content_type', 100);
            table.integer('size_bytes');
            table.string('checksum', 64);
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('updated_at').defaultTo(knex.fn.now());

            table.index('user_id');
        });
    }

    // 3. Add profile_media_id FK to users
    const hasProfileMediaId = await knex.schema.hasColumn('users', 'profile_media_id');
    if (!hasProfileMediaId) {
        await knex.schema.alterTable('users', (table) => {
            table.integer('profile_media_id').references('id').inTable('profile_media').onDelete('SET NULL');
        });
    }

    // 4. Create wishlists table
    const hasWishlists = await knex.schema.hasTable('wishlists');
    if (!hasWishlists) {
        await knex.schema.createTable('wishlists', (table) => {
            table.increments('id').primary();
            table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
            table.string('name', 255).notNullable();
            table.text('description');
            table.string('visibility', 20).defaultTo('private');
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('updated_at').defaultTo(knex.fn.now());

            table.index('user_id');
            table.index('visibility');
        });
    }

    // 5. Create wishlist_items table
    const hasWishlistItems = await knex.schema.hasTable('wishlist_items');
    if (!hasWishlistItems) {
        await knex.schema.createTable('wishlist_items', (table) => {
            table.increments('id').primary();
            table.integer('wishlist_id').notNullable().references('id').inTable('wishlists').onDelete('CASCADE');
            table.integer('collectable_id').references('id').inTable('collectables').onDelete('SET NULL');
            table.text('manual_text');
            table.text('notes');
            table.integer('priority').defaultTo(0);
            table.timestamp('created_at').defaultTo(knex.fn.now());

            table.index('wishlist_id');
            table.index('collectable_id');
        });
    }
};

exports.down = async function (knex) {
    // Drop in reverse order
    await knex.schema.dropTableIfExists('wishlist_items');
    await knex.schema.dropTableIfExists('wishlists');

    await knex.schema.alterTable('users', (table) => {
        table.dropColumn('profile_media_id');
    });

    await knex.schema.dropTableIfExists('profile_media');

    await knex.schema.alterTable('users', (table) => {
        table.dropColumn('bio');
    });
};
