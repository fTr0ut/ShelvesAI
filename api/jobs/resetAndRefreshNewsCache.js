#!/usr/bin/env node
/**
 * Reset and Refresh News Cache
 *
 * Clears the news_items table and refreshes with fresh data from all
 * connected API/Scraping services (TMDB, IGDB, Blu-ray.com).
 *
 * Usage:
 *   node jobs/resetAndRefreshNewsCache.js
 *
 * WARNING: This will DELETE all existing news items before refreshing!
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { query } = require('../database/pg');
const TmdbDiscoveryAdapter = require('../services/discovery/TmdbDiscoveryAdapter');
const IgdbDiscoveryAdapter = require('../services/discovery/IgdbDiscoveryAdapter');
const BlurayDiscoveryAdapter = require('../services/discovery/BlurayDiscoveryAdapter');
const NytDiscoveryAdapter = require('../services/discovery/NytBooksDiscoveryAdapter');
const { getCollectableDiscoveryHook } = require('../services/discovery/CollectableDiscoveryHook');


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
 * Clear all news items from the database
 */
async function clearNewsCache() {
    console.log('[News Cache] Clearing all news items...');
    const result = await query('TRUNCATE TABLE news_items RESTART IDENTITY CASCADE');
    console.log('[News Cache] News cache cleared successfully');
    return result;
}

/**
 * Upsert a news item into the database
 */
async function upsertNewsItem(item) {
    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);

    try {
        await query(`
      INSERT INTO news_items (
        category, item_type, title, description, cover_image_url,
        release_date, physical_release_date, creators, franchises, genres, external_id,
        source_api, source_url, payload, fetched_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), $15)
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
            expiresAt
        ]);
        return true;
    } catch (err) {
        console.error(`[News Cache] Failed to upsert item "${item.title}":`, err.message);
        return false;
    }
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

                // Hook: Add movie to collectables table
                try {
                    const hook = getCollectableDiscoveryHook({ imageBaseUrl: adapter.imageBaseUrl });
                    await hook.processEnrichedItem({
                        source: 'tmdb',
                        kind: 'movie',
                        enrichment: item.payload,
                        originalItem: item
                    });
                } catch (hookErr) {
                    console.warn('[News Cache] Collectable hook failed for TMDB movie:', hookErr.message);
                }
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

                // Hook: Add TV show to collectables table
                try {
                    const hook = getCollectableDiscoveryHook({ imageBaseUrl: adapter.imageBaseUrl });
                    await hook.processEnrichedItem({
                        source: 'tmdb',
                        kind: 'tv',
                        enrichment: item.payload,
                        originalItem: item
                    });
                } catch (hookErr) {
                    console.warn('[News Cache] Collectable hook failed for TMDB TV:', hookErr.message);
                }
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

                // Hook: Add game to collectables table
                try {
                    const hook = getCollectableDiscoveryHook();
                    await hook.processEnrichedItem({
                        source: 'igdb',
                        kind: 'game',
                        enrichment: item.payload,
                        originalItem: item
                    });
                } catch (hookErr) {
                    console.warn('[News Cache] Collectable hook failed for IGDB:', hookErr.message);
                }
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
 * Fetch and store NYT Books
 */

async function refreshNyt(nytAdapter) {
    const stats = { books: 0, errors: 0 };

    try {
        console.log('[News Cache] Fetching NYT Books...');
        const [bestSellerOverview, hardcoverFiction, hardcoverNonfiction, youngAdult] = await Promise.all([
            nytAdapter.fetchBestsellerOverview(),
            nytAdapter.fetchHardcoverFiction(),
            nytAdapter.fetchHardcoverNonfiction(),
            nytAdapter.fetchYoungAdult()

        ]);

        const allBooks = [...bestSellerOverview, ...hardcoverFiction, ...hardcoverNonfiction, ...youngAdult];
        for (const item of allBooks) {
            if (await upsertNewsItem(item)) {
                stats.books++;

                // Hook: Add book to collectables table
                try {
                    const hook = getCollectableDiscoveryHook();
                    await hook.processEnrichedItem({
                        source: 'nyt',
                        kind: 'book',
                        enrichment: item.payload,
                        originalItem: item
                    });
                } catch (hookErr) {
                    console.warn('[News Cache] Collectable hook failed for NYT:', hookErr.message);
                }
            } else {
                stats.errors++;
            }
        }
        console.log(`[News Cache] NYT Books: ${stats.books} items stored`);
    } catch (err) {
        console.error('[News Cache] NYT Books fetch failed:', err.message);
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

                if (await upsertNewsItem(newsItem)) {
                    stats.items++;
                    if (tmdbData) stats.enriched++;

                    // Hook: Also add to collectables table for TMDB-matched items
                    if (tmdbData) {
                        try {
                            const hook = getCollectableDiscoveryHook({ imageBaseUrl: tmdbAdapter.imageBaseUrl });
                            await hook.processEnrichedItem({
                                source: 'bluray',
                                kind: 'movie',
                                enrichment: tmdbData,
                                originalItem: item
                            });
                        } catch (hookErr) {
                            console.warn('[News Cache] Collectable hook failed:', hookErr.message);
                        }
                    }
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
 * Main reset and refresh job
 */
async function runResetAndRefresh() {
    const startTime = Date.now();
    console.log('='.repeat(60));
    console.log(`[News Cache] RESET AND REFRESH at ${new Date().toISOString()}`);
    console.log(`[News Cache] Config: expiryHours=${EXPIRY_HOURS}, itemsPerType=${ITEMS_PER_TYPE}`);
    console.log('='.repeat(60));

    // Step 1: Clear the news cache table
    await clearNewsCache();

    const totals = { items: 0, errors: 0 };

    // Initialize adapters
    const tmdb = new TmdbDiscoveryAdapter();
    const igdb = new IgdbDiscoveryAdapter();

    // Step 2: Refresh TMDB
    if (tmdb.isConfigured()) {
        const tmdbStats = await refreshTmdb(tmdb);
        totals.items += tmdbStats.movies + tmdbStats.tv;
        totals.errors += tmdbStats.errors;
    } else {
        console.warn('[News Cache] TMDB not configured (missing TMDB_API_KEY)');
    }

    // Step 3: Refresh IGDB
    if (igdb.isConfigured()) {
        const igdbStats = await refreshIgdb(igdb);
        totals.items += igdbStats.games;
        totals.errors += igdbStats.errors;
    } else {
        console.warn('[News Cache] IGDB not configured (missing IGDB_CLIENT_ID/SECRET)');
    }

    // Step 4: Refresh Blu-ray.com
    const bluray = new BlurayDiscoveryAdapter();
    if (bluray.isConfigured()) {
        const blurayStats = await refreshBluray(bluray, tmdb);
        totals.items += blurayStats.items;
        totals.errors += blurayStats.errors;
    }

    // Step 5: Refresh NYT Books
    const nytAdapter = new NytDiscoveryAdapter();
    if (nytAdapter.isConfigured()) {
        const nytStats = await refreshNyt(nytAdapter);
        totals.items += nytStats.books;
        totals.errors += nytStats.errors;
    }

    // Print final stats
    const stats = await getCacheStats();
    console.log('\n[News Cache] Current cache contents:');
    for (const row of stats) {
        console.log(`  ${row.category}/${row.item_type}: ${row.count} items`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('='.repeat(60));
    console.log(`[News Cache] RESET COMPLETE. ${totals.items} items refreshed, ${totals.errors} errors`);
    console.log(`[News Cache] Duration: ${duration}s`);
    console.log('='.repeat(60));
}

// Run the job
runResetAndRefresh()
    .then(() => {
        console.log('[News Cache] Reset and refresh job finished successfully');
        process.exit(0);
    })
    .catch((err) => {
        console.error('[News Cache] Reset and refresh job failed:', err);
        process.exit(1);
    });
