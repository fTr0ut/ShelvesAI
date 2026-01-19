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

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const EXPIRY_HOURS = parsePositiveInt(process.env.NEWS_CACHE_EXPIRY_HOURS, 36);
const ITEMS_PER_TYPE = parsePositiveInt(process.env.NEWS_CACHE_ITEMS_PER_TYPE, 20);

/**
 * Upsert a news item into the database
 */
async function upsertNewsItem(item) {
  const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);

  try {
    await query(`
      INSERT INTO news_items (
        category, item_type, title, description, cover_image_url,
        release_date, creators, franchises, genres, external_id,
        source_api, source_url, payload, fetched_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14)
      ON CONFLICT (source_api, external_id, item_type)
      DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        cover_image_url = EXCLUDED.cover_image_url,
        release_date = EXCLUDED.release_date,
        creators = EXCLUDED.creators,
        franchises = EXCLUDED.franchises,
        genres = EXCLUDED.genres,
        source_url = EXCLUDED.source_url,
        payload = EXCLUDED.payload,
        fetched_at = NOW(),
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
    `, [
      item.category,
      item.item_type,
      item.title,
      item.description || null,
      item.cover_image_url || null,
      item.release_date || null,
      item.creators || [],
      item.franchises || [],
      item.genres || [],
      item.external_id,
      item.source_api,
      item.source_url || null,
      JSON.stringify(item.payload || {}),
      expiresAt
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
      if (await upsertNewsItem(item)) {
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
      if (await upsertNewsItem(item)) {
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
      if (await upsertNewsItem(item)) {
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

// Run the job
runRefresh()
  .then(() => {
    console.log('[News Cache] Job finished successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[News Cache] Job failed:', err);
    process.exit(1);
  });
