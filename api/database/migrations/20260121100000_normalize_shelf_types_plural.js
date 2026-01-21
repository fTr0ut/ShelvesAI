/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    // Normalize shelves.type from singular to plural to match news_items.category
    // This fixes the news feed personalization bug where category matching fails
    // because shelves.type uses singular (book, movie, game) while news_items.category
    // uses plural (books, movies, games)
    await knex.raw(`
    UPDATE shelves
    SET type = CASE type
      WHEN 'book' THEN 'books'
      WHEN 'movie' THEN 'movies'
      WHEN 'game' THEN 'games'
      WHEN 'music' THEN 'music'
      ELSE type
    END
    WHERE type IN ('book', 'movie', 'game')
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    // Revert shelves.type from plural back to singular
    await knex.raw(`
    UPDATE shelves
    SET type = CASE type
      WHEN 'books' THEN 'book'
      WHEN 'movies' THEN 'movie'
      WHEN 'games' THEN 'game'
      ELSE type
    END
    WHERE type IN ('books', 'movies', 'games')
  `);
};
