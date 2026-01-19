/**
 * Migration: Create news_items table for discover/news feature
 *
 * Stores cached trending, upcoming, and news items from catalog APIs
 * (TMDB, IGDB, Hardcover) for the personalized discover feed.
 */

exports.up = async function(knex) {
  await knex.schema.createTable('news_items', (table) => {
    table.increments('id').primary();

    // Category mapping to shelf types
    table.text('category').notNullable(); // 'movies', 'tv', 'games', 'books', 'vinyl'

    // Content type
    table.text('item_type').notNullable(); // 'trending', 'upcoming', 'now_playing', 'recent', 'news', 'editorial'

    // Core content
    table.text('title').notNullable();
    table.text('description');
    table.text('cover_image_url');
    table.date('release_date');

    // For matching to user interests
    table.specificType('creators', 'text[]').defaultTo('{}');    // directors, authors, developers
    table.specificType('franchises', 'text[]').defaultTo('{}');  // Marvel, Star Wars, etc.
    table.specificType('genres', 'text[]').defaultTo('{}');

    // External references
    table.text('external_id');           // tmdb:123, igdb:456
    table.text('source_api');            // 'tmdb', 'igdb', 'hardcover', 'gemini'
    table.text('source_url');            // link to more info

    // Full payload for flexibility
    table.jsonb('payload').defaultTo('{}');

    // Cache management
    table.timestamp('fetched_at').defaultTo(knex.fn.now());
    table.timestamp('expires_at').notNullable();

    table.timestamps(true, true);
  });

  // Indexes for efficient queries
  await knex.raw(`
    CREATE INDEX idx_news_items_category ON news_items(category);
    CREATE INDEX idx_news_items_item_type ON news_items(item_type);
    CREATE INDEX idx_news_items_expires_at ON news_items(expires_at);
    CREATE INDEX idx_news_items_release_date ON news_items(release_date);
    CREATE INDEX idx_news_items_creators ON news_items USING gin(creators);
    CREATE INDEX idx_news_items_genres ON news_items USING gin(genres);
    CREATE UNIQUE INDEX idx_news_items_unique ON news_items(source_api, external_id, item_type);
  `);
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('news_items');
};
