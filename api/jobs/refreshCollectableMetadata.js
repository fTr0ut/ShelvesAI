#!/usr/bin/env node
/**
 * Refresh Collectable Metadata: Re-enrich existing collectables from catalog APIs
 *
 * This job queries the collectables table by type and date range, then uses
 * the appropriate catalog service to refresh metadata (without changing fingerprint columns).
 *
 * Usage:
 *   node jobs/refreshCollectableMetadata.js
 *
 * The script will prompt for:
 *   - Start date (YYYY-MM-DD)
 *   - End date (YYYY-MM-DD)
 *   - Collectable type (book, movie, game, tv, or all)
 *
 * Protected columns (NOT updated - used for fingerprinting):
 *   - title, primary_creator, year, kind
 *
 * Updated columns:
 *   - description, subtitle, creators, publishers, tags, genre, runtime
 *   - formats, system_name, identifiers, images
 *   - cover_url, cover_image_url, cover_image_source, attribution, sources
 */

const path = require('path');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { query } = require('../database/pg');
const { BookCatalogService } = require('../services/catalog/BookCatalogService');
const { MovieCatalogService } = require('../services/catalog/MovieCatalogService');
const { GameCatalogService } = require('../services/catalog/GameCatalogService');
const { TvCatalogService } = require('../services/catalog/TvCatalogService');
const { tmdbMovieToCollectable } = require('../adapters/tmdb.adapter');
const { tmdbTvToCollectable } = require('../adapters/tmdbTv.adapter');

// ─────────────────────────────────────────────────────────────────────────────
// CLI Prompts
// ─────────────────────────────────────────────────────────────────────────────

function createPrompt() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

function askQuestion(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

function isValidDate(dateString) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
    const date = new Date(dateString);
    return !isNaN(date.getTime());
}

async function promptForDateRange(rl) {
    let startDate = null;
    let endDate = null;

    while (!startDate) {
        const input = await askQuestion(rl, 'Enter start date (YYYY-MM-DD): ');
        if (isValidDate(input)) {
            startDate = input;
        } else {
            console.log('Invalid date format. Please use YYYY-MM-DD.');
        }
    }

    while (!endDate) {
        const input = await askQuestion(rl, 'Enter end date (YYYY-MM-DD): ');
        if (isValidDate(input)) {
            if (new Date(input) >= new Date(startDate)) {
                endDate = input;
            } else {
                console.log('End date must be on or after start date.');
            }
        } else {
            console.log('Invalid date format. Please use YYYY-MM-DD.');
        }
    }

    return { startDate, endDate };
}

async function promptForType(rl) {
    const validTypes = ['books', 'movies', 'games', 'tv', 'all'];
    let type = null;

    while (!type) {
        const input = await askQuestion(rl, 'Enter collectable type (books, movies, games, tv, all): ');
        const normalized = input.toLowerCase();
        if (validTypes.includes(normalized)) {
            type = normalized;
        } else {
            console.log('Invalid type. Please enter: books, movies, games, tv, or all.');
        }
    }

    return type;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database Queries
// ─────────────────────────────────────────────────────────────────────────────

async function fetchCollectablesByTypeAndDateRange(kind, startDate, endDate) {
    let sql = `
    SELECT id, fingerprint, kind, title, primary_creator, year, 
           subtitle, description, identifiers, external_id
    FROM collectables
    WHERE created_at::date >= $1::date AND created_at::date <= $2::date
  `;
    const params = [startDate, endDate];

    if (kind !== 'all') {
        sql += ` AND kind = $3`;
        params.push(kind);
    }

    sql += ` ORDER BY created_at ASC`;

    const result = await query(sql, params);
    return result.rows;
}

async function updateCollectableMetadata(id, updates) {
    const setClauses = [];
    const params = [id];
    let paramIndex = 2;

    // Build dynamic SET clause for non-fingerprint columns
    const allowedColumns = [
        'description', 'subtitle', 'creators', 'publishers', 'tags', 'genre', 'runtime',
        'formats', 'system_name', 'identifiers', 'images', 'cover_url',
        'cover_image_url', 'cover_image_source', 'attribution', 'sources', 'external_id'
    ];

    for (const [key, value] of Object.entries(updates)) {
        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (allowedColumns.includes(snakeKey) && value !== undefined) {
            setClauses.push(`${snakeKey} = $${paramIndex}`);
            // JSONB fields need JSON.stringify
            const jsonbColumns = ['identifiers', 'images', 'attribution', 'sources', 'formats'];
            // TEXT[] array fields should be passed as native arrays
            const textArrayColumns = ['creators', 'publishers', 'tags', 'genre'];

            if (jsonbColumns.includes(snakeKey)) {
                params.push(JSON.stringify(value));
            } else if (textArrayColumns.includes(snakeKey)) {
                // Pass native array for TEXT[] columns
                params.push(Array.isArray(value) ? value : []);
            } else {
                params.push(value);
            }
            paramIndex++;
        }
    }

    if (setClauses.length === 0) {
        return null;
    }

    setClauses.push('updated_at = NOW()');

    const sql = `
    UPDATE collectables
    SET ${setClauses.join(', ')}
    WHERE id = $1
    RETURNING id, title
  `;

    const result = await query(sql, params);
    return result.rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog Service Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pickCoverUrl(images, fallback) {
    if (fallback) return fallback;
    if (!Array.isArray(images)) return null;
    for (const image of images) {
        if (!image || typeof image !== 'object') continue;
        const url = image.urlLarge || image.urlMedium || image.urlSmall || image.url;
        if (url) return url;
    }
    return null;
}

function extractBookUpdates(lookupResult) {
    if (!lookupResult) return null;

    const isCollectable =
        lookupResult.__collectable ||
        lookupResult.kind === 'book' ||
        Array.isArray(lookupResult.creators) ||
        Array.isArray(lookupResult.images);

    if (isCollectable) {
        const creators = Array.isArray(lookupResult.creators)
            ? lookupResult.creators
            : lookupResult.primaryCreator
                ? [lookupResult.primaryCreator]
                : [];
        const tags = Array.isArray(lookupResult.tags) ? lookupResult.tags : [];
        const genre = Array.isArray(lookupResult.genre)
            ? lookupResult.genre
            : tags.slice(0, 10);
        const images = Array.isArray(lookupResult.images) ? lookupResult.images : [];
        const coverUrl = pickCoverUrl(images, lookupResult.coverUrl || lookupResult.coverImageUrl);

        return {
            description: lookupResult.description || null,
            subtitle: lookupResult.subtitle || null,
            creators,
            publishers: lookupResult.publishers || [],
            tags,
            genre,
            identifiers: lookupResult.identifiers || {},
            images,
            coverUrl: coverUrl || null,
            coverImageUrl: lookupResult.coverImageUrl || null,
            coverImageSource: lookupResult.coverImageSource || 'external',
            attribution: lookupResult.attribution || null,
            sources: lookupResult.sources || [],
            externalId: lookupResult.externalId || null,
        };
    }

    // lookupResult is from OpenLibrary's toCollectionDoc or Hardcover
    return {
        description: lookupResult.description || null,
        subtitle: lookupResult.subtitle || null,
        creators: lookupResult.authors || [],
        publishers: lookupResult.publishers || [],
        tags: lookupResult.subjects || [],
        genre: lookupResult.subjects?.slice(0, 10) || [], // Map subjects to genre
        identifiers: lookupResult.identifiers || {},
        images: lookupResult.cover?.urls ? [{
            kind: 'cover',
            urlLarge: lookupResult.cover.urls.large,
            urlMedium: lookupResult.cover.urls.medium,
            urlSmall: lookupResult.cover.urls.small,
            provider: 'openlibrary',
        }] : [],
        coverUrl: lookupResult.coverImageUrl || lookupResult.cover?.urls?.large || null,
        coverImageUrl: lookupResult.coverImageUrl || null,
        coverImageSource: lookupResult.coverImageSource || 'external',
        attribution: lookupResult.attribution || null,
        sources: lookupResult.source ? [lookupResult.source] : [],
        externalId: lookupResult.workId ? `openlibrary:${lookupResult.workId}` : null,
    };
}

function extractMovieUpdates(lookupResult, imageBaseUrl) {
    if (!lookupResult?.movie) return null;

    const collectable = tmdbMovieToCollectable(lookupResult.movie, {
        imageBaseUrl: imageBaseUrl || 'https://image.tmdb.org/t/p',
    });

    if (!collectable) return null;

    return {
        description: collectable.description || null,
        creators: collectable.creators || [],
        publishers: collectable.publishers || [],
        genre: collectable.genre || [],
        runtime: collectable.runtime || null,
        formats: collectable.formats || [],
        identifiers: collectable.identifiers || {},
        images: collectable.images || [],
        coverUrl: collectable.coverUrl || null,
        coverImageUrl: collectable.coverImageUrl || null,
        coverImageSource: collectable.coverImageSource || null,
        attribution: collectable.attribution || null,
        sources: collectable.sources || [],
        externalId: collectable.externalId || null,
    };
}

function extractTvUpdates(lookupResult, imageBaseUrl) {
    if (!lookupResult?.tv) return null;

    const collectable = tmdbTvToCollectable(lookupResult.tv, {
        imageBaseUrl: imageBaseUrl || 'https://image.tmdb.org/t/p',
    });

    if (!collectable) return null;

    return {
        description: collectable.description || null,
        creators: collectable.creators || [],
        publishers: collectable.publishers || [],
        genre: collectable.genre || [],
        runtime: collectable.runtime || null,
        identifiers: collectable.identifiers || {},
        images: collectable.images || [],
        coverUrl: collectable.coverUrl || null,
        coverImageUrl: collectable.coverImageUrl || null,
        coverImageSource: collectable.coverImageSource || null,
        attribution: collectable.attribution || null,
        sources: collectable.sources || [],
        externalId: collectable.externalId || null,
    };
}

function extractGameUpdates(lookupResult) {
    if (!lookupResult?.game) return null;

    const game = lookupResult.game;

    // Build the updates from the IGDB game object
    const developerNames = [];
    const publisherNames = [];

    if (Array.isArray(game.involved_companies)) {
        for (const ic of game.involved_companies) {
            if (ic?.company?.name) {
                if (ic.developer) developerNames.push(ic.company.name);
                if (ic.publisher) publisherNames.push(ic.company.name);
            }
        }
    }

    const genres = Array.isArray(game.genres)
        ? game.genres.map(g => g?.name).filter(Boolean)
        : [];

    const keywords = Array.isArray(game.keywords)
        ? game.keywords.map(k => k?.name).filter(Boolean)
        : [];

    const descriptions = [game.summary, game.storyline].filter(Boolean);

    // Build cover image URL
    const coverId = game.cover?.image_id;
    const coverUrl = coverId ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${coverId}.jpg` : null;

    // Extract platform name
    let systemName = null;
    if (Array.isArray(game.platforms) && game.platforms.length > 0) {
        systemName = game.platforms[0]?.name || null;
    }

    return {
        description: descriptions.join('\n\n') || null,
        creators: developerNames,
        publishers: publisherNames,
        tags: keywords.slice(0, 20),
        genre: genres,
        systemName: systemName,
        identifiers: { igdb: String(game.id) },
        images: coverId ? [{
            kind: 'cover',
            urlLarge: `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${coverId}.jpg`,
            urlMedium: coverUrl,
            urlSmall: `https://images.igdb.com/igdb/image/upload/t_thumb/${coverId}.jpg`,
            provider: 'igdb',
        }] : [],
        coverUrl: coverUrl,
        coverImageUrl: coverUrl,
        coverImageSource: null, // Will be cached locally
        externalId: `igdb:${game.id}`,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Enrichment Logic
// ─────────────────────────────────────────────────────────────────────────────

async function enrichCollectable(collectable, services) {
    const { kind, title, primary_creator: primaryCreator, year, identifiers } = collectable;

    const item = {
        title,
        name: title,
        primaryCreator,
        author: primaryCreator,
        year,
        identifiers: typeof identifiers === 'string' ? JSON.parse(identifiers) : identifiers,
    };

    try {
        switch (kind) {
            case 'books': {
                const result = await services.book.safeLookup(item);
                return extractBookUpdates(result);
            }
            case 'movies': {
                const result = await services.movie.safeLookup(item);
                return extractMovieUpdates(result, services.movie.imageBaseUrl);
            }
            case 'games': {
                const result = await services.game.safeLookup(item);
                return extractGameUpdates(result);
            }
            case 'tv': {
                const result = await services.tv.safeLookup(item);
                return extractTvUpdates(result, services.tv.imageBaseUrl);
            }
            default:
                console.warn(`[Enrichment] Unknown kind: ${kind}`);
                return null;
        }
    } catch (err) {
        console.error(`[Enrichment] Error enriching ${kind} "${title}":`, err.message);
        return null;
    }
}

async function runEnrichment() {
    const rl = createPrompt();

    console.log('='.repeat(60));
    console.log('[Collectable Enrichment] Starting...');
    console.log('='.repeat(60));
    console.log('');

    // Prompt for parameters
    const { startDate, endDate } = await promptForDateRange(rl);
    const type = await promptForType(rl);

    rl.close();

    console.log('');
    console.log(`[Enrichment] Config: type=${type}, startDate=${startDate}, endDate=${endDate}`);
    console.log('');

    // Initialize catalog services
    const services = {
        book: new BookCatalogService(),
        movie: new MovieCatalogService(),
        game: new GameCatalogService(),
        tv: new TvCatalogService(),
    };

    // Fetch collectables
    console.log('[Enrichment] Fetching collectables...');
    const collectables = await fetchCollectablesByTypeAndDateRange(type, startDate, endDate);
    console.log(`[Enrichment] Found ${collectables.length} collectables to process`);
    console.log('');

    if (collectables.length === 0) {
        console.log('[Enrichment] No collectables found in the specified range.');
        return;
    }

    // Process each collectable
    const stats = {
        processed: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
    };

    for (const collectable of collectables) {
        stats.processed++;
        const label = `[${stats.processed}/${collectables.length}] ${collectable.kind}: "${collectable.title}"`;

        try {
            const updates = await enrichCollectable(collectable, services);

            if (!updates) {
                console.log(`${label} - SKIPPED (no match found)`);
                stats.skipped++;
                continue;
            }

            const result = await updateCollectableMetadata(collectable.id, updates);

            if (result) {
                console.log(`${label} - UPDATED`);
                stats.updated++;
            } else {
                console.log(`${label} - SKIPPED (no updates to apply)`);
                stats.skipped++;
            }
        } catch (err) {
            console.error(`${label} - ERROR: ${err.message}`);
            stats.errors++;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Print summary
    console.log('');
    console.log('='.repeat(60));
    console.log('[Enrichment] Complete!');
    console.log(`  Processed: ${stats.processed}`);
    console.log(`  Updated:   ${stats.updated}`);
    console.log(`  Skipped:   ${stats.skipped}`);
    console.log(`  Errors:    ${stats.errors}`);
    console.log('='.repeat(60));
}

// Run the job
runEnrichment()
    .then(() => {
        console.log('[Enrichment] Job finished successfully');
        process.exit(0);
    })
    .catch((err) => {
        console.error('[Enrichment] Job failed:', err);
        process.exit(1);
    });
