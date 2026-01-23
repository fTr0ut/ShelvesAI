#!/usr/bin/env node
/**
 * Refresh News Cache: Fetch trending/upcoming items from catalog APIs
 *
 * This job populates the news_items table with content from TMDB and IGDB
 * for the personalized discover feed.
 *
 * Usage:
 *   node jobs/refreshNewsCache.js
 *
 * Schedule daily at 4am:
 *   0 4 * * * cd /path/to/api && node jobs/refreshNewsCache.js >> logs/news-cache.log 2>&1
 *
 * Environment variables:
 *   NEWS_CACHE_EXPIRY_HOURS - Hours until items expire (default: 36)
 *   NEWS_CACHE_ITEMS_PER_TYPE - Max items per type/category (default: 20)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { query } = require('../database/pg');
const TmdbDiscoveryAdapter = require('../services/discovery/TmdbDiscoveryAdapter');
const IgdbDiscoveryAdapter = require('../services/discovery/IgdbDiscoveryAdapter');
const BlurayDiscoveryAdapter = require('../services/discovery/BlurayDiscoveryAdapter');
const NytBooksDiscoveryAdapter = require('../services/discovery/NytBooksDiscoveryAdapter');
const { getCollectableDiscoveryHook } = require('../services/discovery/CollectableDiscoveryHook');
const { BookCatalogService } = require('../services/catalog/BookCatalogService');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const EXPIRY_HOURS = parsePositiveInt(process.env.NEWS_CACHE_EXPIRY_HOURS, 36);
const ITEMS_PER_TYPE = parsePositiveInt(process.env.NEWS_CACHE_ITEMS_PER_TYPE, 20);

/**
 * Check if a value is a valid Date object
 */
function isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

/**
 * Safely convert a value to a Date or return null
 */
function toSafeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return isValidDate(date) ? date : null;
}

/**
 * Upsert a news item into the database
 */
async function upsertNewsItem(item, collectableId = null) {
  const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);

  try {
    await query(`
      INSERT INTO news_items (
        category, item_type, title, description, cover_image_url,
        release_date, physical_release_date, creators, franchises, genres, external_id,
        source_api, source_url, payload, fetched_at, expires_at, collectable_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), $15, $16)
      ON CONFLICT (source_api, external_id, item_type)
      DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        cover_image_url = EXCLUDED.cover_image_url,
        release_date = EXCLUDED.release_date,
        physical_release_date = EXCLUDED.physical_release_date,
        creators = EXCLUDED.creators,
        franchises = EXCLUDED.franchises,
        genres = EXCLUDED.genres,
        source_url = EXCLUDED.source_url,
        payload = EXCLUDED.payload,
        fetched_at = NOW(),
        expires_at = EXCLUDED.expires_at,
        collectable_id = COALESCE(EXCLUDED.collectable_id, news_items.collectable_id),
        updated_at = NOW()
    `, [
      item.category,
      item.item_type,
      item.title,
      item.description || null,
      item.cover_image_url || null,
      toSafeDate(item.release_date),
      toSafeDate(item.physical_release_date),
      item.creators || [],
      item.franchises || [],
      item.genres || [],
      item.external_id,
      item.source_api,
      item.source_url || null,
      JSON.stringify(item.payload || {}),
      expiresAt,
      collectableId
    ]);
    return true;
  } catch (err) {
    console.error(`[News Cache] Failed to upsert item "${item.title}":`, err.message);
    return false;
  }
}

/**
 * Remove expired news items
 */
async function cleanupExpired() {
  const result = await query(`
    DELETE FROM news_items WHERE expires_at < NOW()
  `);
  return result.rowCount || 0;
}

/**
 * Get current cache stats
 */
async function getCacheStats() {
  const result = await query(`
    SELECT
      category,
      item_type,
      COUNT(*) as count
    FROM news_items
    WHERE expires_at > NOW()
    GROUP BY category, item_type
    ORDER BY category, item_type
  `);
  return result.rows;
}

/**
 * Fetch and store TMDB content
 */
async function refreshTmdb(adapter) {
  const stats = { movies: 0, tv: 0, errors: 0 };

  // Fetch movies
  try {
    console.log('[News Cache] Fetching TMDB movies...');
    const [trending, upcoming, nowPlaying] = await Promise.all([
      adapter.fetchTrendingMovies(ITEMS_PER_TYPE),
      adapter.fetchUpcomingMovies(ITEMS_PER_TYPE),
      adapter.fetchNowPlayingMovies(ITEMS_PER_TYPE)
    ]);

    const allMovies = [...trending, ...upcoming, ...nowPlaying];
    for (const item of allMovies) {
      // Hook: Add movie to collectables table FIRST to get collectable.id
      let collectableId = null;
      try {
        const hook = getCollectableDiscoveryHook({ imageBaseUrl: adapter.imageBaseUrl });
        const hookResult = await hook.processEnrichedItem({
          source: 'tmdb',
          kind: 'movie',
          enrichment: item.payload,
          originalItem: item
        });
        collectableId = hookResult.collectable?.id || null;
      } catch (hookErr) {
        console.warn('[News Cache] Collectable hook failed for TMDB movie:', hookErr.message);
      }

      if (await upsertNewsItem(item, collectableId)) {
        stats.movies++;
      } else {
        stats.errors++;
      }
    }
    console.log(`[News Cache] TMDB movies: ${stats.movies} items stored`);
  } catch (err) {
    console.error('[News Cache] TMDB movies fetch failed:', err.message);
    stats.errors++;
  }

  // Fetch TV shows
  try {
    console.log('[News Cache] Fetching TMDB TV shows...');
    const [trending, onAir] = await Promise.all([
      adapter.fetchTrendingTV(ITEMS_PER_TYPE),
      adapter.fetchOnTheAirTV(ITEMS_PER_TYPE)
    ]);

    const allTV = [...trending, ...onAir];
    for (const item of allTV) {
      // Hook: Add TV show to collectables table FIRST to get collectable.id
      let collectableId = null;
      try {
        const hook = getCollectableDiscoveryHook({ imageBaseUrl: adapter.imageBaseUrl });
        const hookResult = await hook.processEnrichedItem({
          source: 'tmdb',
          kind: 'tv',
          enrichment: item.payload,
          originalItem: item
        });
        collectableId = hookResult.collectable?.id || null;
      } catch (hookErr) {
        console.warn('[News Cache] Collectable hook failed for TMDB TV:', hookErr.message);
      }

      if (await upsertNewsItem(item, collectableId)) {
        stats.tv++;
      } else {
        stats.errors++;
      }
    }
    console.log(`[News Cache] TMDB TV: ${stats.tv} items stored`);
  } catch (err) {
    console.error('[News Cache] TMDB TV fetch failed:', err.message);
    stats.errors++;
  }

  return stats;
}

/**
 * Fetch and store IGDB content
 */
async function refreshIgdb(adapter) {
  const stats = { games: 0, errors: 0 };

  try {
    console.log('[News Cache] Fetching IGDB games...');
    const [topRated, mostFollowed, recent, popular] = await Promise.all([
      adapter.fetchTopRatedGames(ITEMS_PER_TYPE),
      adapter.fetchMostFollowedGames(ITEMS_PER_TYPE),
      adapter.fetchRecentReleases(ITEMS_PER_TYPE),
      adapter.fetchPopularGames(ITEMS_PER_TYPE)
    ]);

    // Deduplicate by external_id (same game might appear in multiple lists)
    const seen = new Set();
    const allGames = [...topRated, ...mostFollowed, ...recent, ...popular].filter(game => {
      if (seen.has(game.external_id)) return false;
      seen.add(game.external_id);
      return true;
    });

    for (const item of allGames) {
      // Hook: Add game to collectables table FIRST to get collectable.id
      let collectableId = null;
      try {
        const hook = getCollectableDiscoveryHook();
        const hookResult = await hook.processEnrichedItem({
          source: 'igdb',
          kind: 'game',
          enrichment: item.payload,
          originalItem: item
        });
        collectableId = hookResult.collectable?.id || null;
      } catch (hookErr) {
        console.warn('[News Cache] Collectable hook failed for IGDB:', hookErr.message);
      }

      if (await upsertNewsItem(item, collectableId)) {
        stats.games++;
      } else {
        stats.errors++;
      }
    }
    console.log(`[News Cache] IGDB games: ${stats.games} items stored`);
  } catch (err) {
    console.error('[News Cache] IGDB fetch failed:', err.message);
    stats.errors++;
  }

  return stats;
}

/**
 * Fetch and store Blu-ray.com content (Physical Releases)
 */
async function refreshBluray(blurayAdapter, tmdbAdapter) {
  const stats = { items: 0, enriched: 0, errors: 0 };

  try {
    console.log('[News Cache] Fetching Blu-ray.com releases...');

    // Fetch all 6 distinct categories
    const [
      preorder4K,
      preorderBluray,
      newRelease4K,
      newReleaseBluray,
      upcoming4K,
      upcomingBluray
    ] = await Promise.all([
      blurayAdapter.fetchNewPreorders4K(),
      blurayAdapter.fetchNewPreordersBluray(),
      blurayAdapter.fetchNewReleases4K(),
      blurayAdapter.fetchNewReleasesBluray(),
      blurayAdapter.fetchUpcomingReleases4K(),
      blurayAdapter.fetchUpcomingReleasesBluray()
    ]);

    // Combine and mark types
    const items = [
      ...preorder4K.map(i => ({ ...i, type: 'preorder_4k' })),
      ...preorderBluray.map(i => ({ ...i, type: 'preorder_bluray' })),
      ...newRelease4K.map(i => ({ ...i, type: 'new_release_4k' })),
      ...newReleaseBluray.map(i => ({ ...i, type: 'new_release_bluray' })),
      ...upcoming4K.map(i => ({ ...i, type: 'upcoming_4k' })),
      ...upcomingBluray.map(i => ({ ...i, type: 'upcoming_bluray' }))
    ];

    console.log(`[News Cache] Blu-ray.com totals: preorder_4k=${preorder4K.length}, preorder_bluray=${preorderBluray.length}, new_release_4k=${newRelease4K.length}, new_release_bluray=${newReleaseBluray.length}, upcoming_4k=${upcoming4K.length}, upcoming_bluray=${upcomingBluray.length}`);

    // Deduplicate by URL
    const uniqueItems = [];
    const seenUrls = new Set();

    for (const item of items) {
      if (!seenUrls.has(item.source_url)) {
        seenUrls.add(item.source_url);
        uniqueItems.push(item);
      }
    }

    for (const item of uniqueItems) {
      try {
        // Enrichment
        let tmdbData = null;
        if (tmdbAdapter && tmdbAdapter.isConfigured()) {
          // Note: We don't pass year because the physical release date differs from theatrical release
          const searchResults = await tmdbAdapter.searchMovie({ title: item.title });

          if (searchResults.length > 0) {
            tmdbData = searchResults[0];
          }
        }

        if (tmdbData) {
          await query(
            'DELETE FROM news_items WHERE source_api = $1 AND source_url = $2 AND item_type = $3',
            ['blu-ray.com', item.source_url, item.type]
          );
        }

        const tmdbSourceUrl = tmdbData ? `https://www.themoviedb.org/movie/${tmdbData.id}` : null;
        const sourceApi = tmdbData ? 'tmdb' : 'blu-ray.com';
        const sourceUrl = tmdbData ? tmdbSourceUrl : item.source_url;

        // Construct News Item
        const newsItem = {
          category: 'movies',
          item_type: item.type,
          title: tmdbData ? (tmdbData.title || tmdbData.original_title) : item.title,
          description: tmdbData ? tmdbData.overview : null,
          cover_image_url: tmdbData && tmdbData.poster_path ? `${tmdbAdapter.imageBaseUrl}${tmdbData.poster_path}` : null,
          release_date: toSafeDate(tmdbData?.release_date),
          physical_release_date: toSafeDate(item.release_date),
          creators: [],
          franchises: [],
          genres: tmdbData ? (tmdbData.genre_ids || []).map(id => tmdbAdapter.movieGenres[id]).filter(Boolean) : [],
          external_id: tmdbData ? `tmdb:${tmdbData.id}` : `bluray:${item.title.replace(/\s+/g, '_').toLowerCase()}`,
          source_api: sourceApi,
          source_url: sourceUrl,
          payload: {
            original_source: 'blu-ray.com',
            original_source_url: item.source_url,
            tmdb_match: !!tmdbData,
            tmdb_id: tmdbData ? tmdbData.id : null,
            original_title: item.title,
            physical_release_date: toSafeDate(item.release_date)?.toISOString().split('T')[0] ?? null
          }
        };

        // Hook: Add to collectables table FIRST for TMDB-matched items to get collectable.id
        let collectableId = null;
        if (tmdbData) {
          try {
            const hook = getCollectableDiscoveryHook({ imageBaseUrl: tmdbAdapter.imageBaseUrl });
            const hookResult = await hook.processEnrichedItem({
              source: 'bluray',
              kind: 'movie',
              enrichment: tmdbData,
              originalItem: item
            });
            collectableId = hookResult.collectable?.id || null;
          } catch (hookErr) {
            console.warn('[News Cache] Collectable hook failed:', hookErr.message);
          }
        }

        if (await upsertNewsItem(newsItem, collectableId)) {
          stats.items++;
          if (tmdbData) stats.enriched++;
        } else {
          stats.errors++;
        }

      } catch (innerErr) {
        console.error(`[News Cache] Failed to process bluray item ${item.title}:`, innerErr);
        stats.errors++;
      }
    }

    console.log(`[News Cache] Blu-ray.com: ${stats.items} items stored (${stats.enriched} enriched)`);

  } catch (err) {
    console.error('[News Cache] Blu-ray fetch failed:', err.message);
    stats.errors++;
  }

  return stats;
}

/**
 * Fetch and store NYT Bestseller books
 */
async function refreshNytBooks(adapter) {
  const stats = { books: 0, enriched: 0, errors: 0 };
  const bookCatalog = new BookCatalogService();

  try {
    console.log('[News Cache] Fetching NYT bestsellers...');
    const allBooks = await adapter.fetchBestsellerOverview();

    // Deduplicate by external_id (same book might appear in multiple lists)
    const seen = new Set();
    const uniqueBooks = allBooks.filter(book => {
      if (seen.has(book.external_id)) return false;
      seen.add(book.external_id);
      return true;
    });

    for (const item of uniqueBooks) {
      // Enrich via BookCatalogService (OpenLibrary → Hardcover fallback) FIRST
      let enrichedData = null;
      let enrichmentSource = 'nyt';
      try {
        const lookupItem = {
          title: item.title,
          author: item.creators?.[0],
          identifiers: {
            isbn13: item.payload?.primary_isbn13 ? [item.payload.primary_isbn13] : [],
            isbn10: item.payload?.primary_isbn10 ? [item.payload.primary_isbn10] : []
          }
        };
        enrichedData = await bookCatalog.safeLookup(lookupItem);
        if (enrichedData) {
          enrichmentSource = enrichedData.provider || 'openlibrary';
        }
      } catch (enrichErr) {
        console.warn('[News Cache] Book enrichment failed:', enrichErr.message);
      }

      // Hook: Add book to collectables table to get collectable.id
      let collectableId = null;
      try {
        const hook = getCollectableDiscoveryHook();
        const hookResult = await hook.processEnrichedItem({
          source: enrichmentSource,
          kind: 'books',
          enrichment: enrichedData || item.payload,
          originalItem: item
        });
        collectableId = hookResult.collectable?.id || null;
      } catch (hookErr) {
        console.warn('[News Cache] Collectable hook failed for NYT book:', hookErr.message);
      }

      if (await upsertNewsItem(item, collectableId)) {
        stats.books++;
        if (enrichedData) stats.enriched++;
      } else {
        stats.errors++;
      }
    }
    console.log(`[News Cache] NYT Books: ${stats.books} items stored (${stats.enriched} enriched)`);
  } catch (err) {
    console.error('[News Cache] NYT Books fetch failed:', err.message);
    stats.errors++;
  }

  return stats;
}

/**
 * Main refresh job
 */
async function runRefresh() {
  const startTime = Date.now();
  console.log('='.repeat(60));
  console.log(`[News Cache] Starting refresh at ${new Date().toISOString()}`);
  console.log(`[News Cache] Config: expiryHours=${EXPIRY_HOURS}, itemsPerType=${ITEMS_PER_TYPE}`);
  console.log('='.repeat(60));

  const totals = { items: 0, errors: 0 };

  // Initialize adapters
  const tmdb = new TmdbDiscoveryAdapter();
  const igdb = new IgdbDiscoveryAdapter();

  // Refresh TMDB
  if (tmdb.isConfigured()) {
    const tmdbStats = await refreshTmdb(tmdb);
    totals.items += tmdbStats.movies + tmdbStats.tv;
    totals.errors += tmdbStats.errors;
  } else {
    console.warn('[News Cache] TMDB not configured (missing TMDB_API_KEY)');
  }

  // Refresh IGDB
  if (igdb.isConfigured()) {
    const igdbStats = await refreshIgdb(igdb);
    totals.items += igdbStats.games;
    totals.errors += igdbStats.errors;
  } else {
    console.warn('[News Cache] IGDB not configured (missing IGDB_CLIENT_ID/SECRET)');
  }

  // Refresh Blu-ray.com
  const bluray = new BlurayDiscoveryAdapter();
  if (bluray.isConfigured()) {
    const blurayStats = await refreshBluray(bluray, tmdb);
    totals.items += blurayStats.items;
    totals.errors += blurayStats.errors;
  }

  // Refresh NYT Books
  const nyt = new NytBooksDiscoveryAdapter();
  if (nyt.isConfigured()) {
    const nytStats = await refreshNytBooks(nyt);
    totals.items += nytStats.books;
    totals.errors += nytStats.errors;
  } else {
    console.warn('[News Cache] NYT Books not configured (missing NYT_BOOKS_API_KEY)');
  }

  // Cleanup expired items
  const cleaned = await cleanupExpired();
  console.log(`[News Cache] Cleaned up ${cleaned} expired items`);

  // Print final stats
  const stats = await getCacheStats();
  console.log('\n[News Cache] Current cache contents:');
  for (const row of stats) {
    console.log(`  ${row.category}/${row.item_type}: ${row.count} items`);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('='.repeat(60));
  console.log(`[News Cache] Complete. ${totals.items} items refreshed, ${totals.errors} errors, ${cleaned} expired removed`);
  console.log(`[News Cache] Duration: ${duration}s`);
  console.log('='.repeat(60));
}

module.exports = {
  runRefresh,
};

if (require.main === module) {
  runRefresh()
    .then(() => {
      console.log('[News Cache] Job finished successfully');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[News Cache] Job failed:', err);
      process.exit(1);
    });
}
