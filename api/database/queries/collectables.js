const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');
const { ensureCoverMediaForCollectable } = require('./media');
const { normalizeCollectableKind } = require('../../services/collectables/kind');
const { appendJobEvent } = require('./jobRuns');
const { getJobId, getUserId } = require('../../context');
const logger = require('../../logger');
const {
    normalizeSearchText,
    normalizeSearchWildcardPattern,
    buildNormalizedSqlExpression,
} = require('../../utils/searchNormalization');

/**
 * Resolve the query executor: use the provided client if given, otherwise use the shared pool query.
 * @param {import('pg').PoolClient|null} client
 * @returns {Function}
 */
function resolveQuery(client) {
    return client ? client.query.bind(client) : query;
}

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

function normalizeFormats(values, fallback) {
    const raw = [];
    if (Array.isArray(values)) raw.push(...values);
    else if (values) raw.push(values);
    if (fallback) raw.push(fallback);
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
        const normalized = String(entry ?? '').trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

function normalizeStringArray(input) {
    if (input == null) return [];
    const source = Array.isArray(input) ? input : [input];
    const seen = new Set();
    const out = [];
    for (const entry of source) {
        const normalized = normalizeString(entry);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}

function normalizeMarketValueSources(input) {
    if (input == null) return [];
    const source = Array.isArray(input) ? input : [input];
    const out = [];
    for (const entry of source) {
        if (!entry) continue;
        if (typeof entry === 'string') {
            const url = normalizeString(entry);
            if (!url) continue;
            out.push({ url });
            continue;
        }
        if (typeof entry === 'object') {
            const url = normalizeString(entry.url || entry.link || entry.href);
            if (!url) continue;
            const label = normalizeString(entry.label || entry.name || entry.title) || null;
            out.push(label ? { url, label } : { url });
        }
    }
    return out;
}

function ensureJsonParam(value, fieldName) {
    if (value == null) return null;
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch (err) {
        throw new Error(`[collectables.upsert] Failed to serialize ${fieldName} as JSON`);
    }
}

/**
 * Find collectable by fingerprint
 */
async function findByFingerprint(fingerprint) {
    if (!fingerprint) return null;
    const result = await query(
        `SELECT c.*, m.local_path as cover_media_path
         FROM collectables c
         LEFT JOIN media m ON m.id = c.cover_media_id
         WHERE c.fingerprint = $1`,
        [fingerprint]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Find collectable by external source ID
 * Supports formats like "tmdb:123" or separate externalId/sourceApi params
 * Checks both external_id column and identifiers JSONB field
 */
async function findBySourceId(externalId, sourceApi) {
    if (!externalId) return null;

    // Parse "tmdb:123" format if sourceApi not provided
    let parsedId = externalId;
    let parsedSource = sourceApi;
    if (!sourceApi && typeof externalId === 'string' && externalId.includes(':')) {
        const [source, id] = externalId.split(':');
        parsedSource = source;
        parsedId = id;
    }

    // Build full external_id string for lookup
    const fullExternalId = parsedSource ? `${parsedSource}:${parsedId}` : parsedId;

    // First try external_id column
    let result = await query(
        `SELECT c.*, m.local_path as cover_media_path
         FROM collectables c
         LEFT JOIN media m ON m.id = c.cover_media_id
         WHERE c.external_id = $1`,
        [fullExternalId]
    );

    if (result.rows[0]) {
        return rowToCamelCase(result.rows[0]);
    }

    // Try identifiers JSONB field if source is known
    if (parsedSource) {
        result = await query(
            `SELECT c.*, m.local_path as cover_media_path
             FROM collectables c
             LEFT JOIN media m ON m.id = c.cover_media_id
             WHERE c.identifiers->>$1 = $2`,
            [parsedSource, parsedId]
        );

        if (result.rows[0]) {
            return rowToCamelCase(result.rows[0]);
        }
    }

    return null;
}

/**
 * Find collectable by lightweight fingerprint
 */
async function findByLightweightFingerprint(lwf) {
    if (!lwf) return null;
    const result = await query(
        `SELECT c.*, m.local_path as cover_media_path
         FROM collectables c
         LEFT JOIN media m ON m.id = c.cover_media_id
         WHERE c.lightweight_fingerprint = $1`,
        [lwf]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Find collectable by ID
 */
async function findById(id) {
    const result = await query(
        `SELECT c.*, m.local_path as cover_media_path
         FROM collectables c
         LEFT JOIN media m ON m.id = c.cover_media_id
         WHERE c.id = $1`,
        [id]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Search collectables by title using trigram similarity
 */
async function searchByTitle(term, kind = null, limit = 20) {
    const normalizedTerm = normalizeSearchText(term);
    const normalizedTitleExpr = buildNormalizedSqlExpression('c.title');

    let sql = `
    SELECT c.*,
           GREATEST(
             similarity(c.title, $1),
             similarity(${normalizedTitleExpr}, $2)
           ) AS sim,
           m.local_path as cover_media_path
    FROM collectables c
    LEFT JOIN media m ON m.id = c.cover_media_id
    WHERE c.title % $1 OR ${normalizedTitleExpr} % $2
  `;
    const params = [term, normalizedTerm];

    const normalizedKind = kind ? normalizeCollectableKind(kind) : null;
    if (normalizedKind) {
        sql += ` AND c.kind = $3`;
        params.push(normalizedKind);
    }

    sql += ` ORDER BY sim DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);
    return result.rows.map(rowToCamelCase);
}

/**
 * Upsert a collectable (insert or update on conflict)
 * @param {object} data - Collectable data
 * @param {import('pg').PoolClient|null} [client] - Optional transaction client
 */
async function upsert(data, client = null) {
    const {
        fingerprint,
        lightweightFingerprint,
        kind,
        title,
        subtitle,
        description,
        primaryCreator,
        creators = [],
        publishers = [],
        year,
        marketValue,
        marketValueSources = [],
        format,
        formats,
        systemName,
        tags = [],
        genre,
        runtime,
        identifiers = {},
        images = [],
        coverUrl,
        sources = [],
        externalId,
        fuzzyFingerprints = [],
        coverImageUrl,
        coverImageSource = 'external',
        attribution = null,
        metascore = null,
    } = data;

    const resolvedCoverUrl = pickCoverUrl(images, coverUrl);
    const normalizedFormats = normalizeFormats(formats, format);
    const normalizedCreators = normalizeStringArray(creators);
    const resolvedPrimaryCreator = normalizeString(primaryCreator) || normalizedCreators[0] || null;
    const normalizedGenre = Array.isArray(genre) && genre.length ? genre : null;
    const normalizedMarketValueSources = normalizeMarketValueSources(marketValueSources);
    const normalizedRuntime = runtime == null
        ? null
        : Number.isFinite(runtime)
            ? runtime
            : Number.isFinite(Number(runtime))
                ? Number(runtime)
                : null;

    const normalizedKind = normalizeCollectableKind(kind, 'item');
    const normalizedIdentifiers = identifiers && typeof identifiers === 'object' && !Array.isArray(identifiers)
        ? identifiers
        : {};
    const identifiersJson = ensureJsonParam(normalizedIdentifiers, 'identifiers');
    const marketValueSourcesJson = ensureJsonParam(normalizedMarketValueSources, 'marketValueSources');
    const formatsJson = ensureJsonParam(normalizedFormats, 'formats');
    const imagesJson = ensureJsonParam(images, 'images');
    const sourcesJson = ensureJsonParam(sources, 'sources');
    const fuzzyFingerprintsJson = ensureJsonParam(fuzzyFingerprints, 'fuzzyFingerprints');
    const attributionJson = attribution ? ensureJsonParam(attribution, 'attribution') : null;
    const metascoreJson = metascore ? ensureJsonParam(metascore, 'metascore') : null;
    const q = resolveQuery(client);
    const result = await q(
        `INSERT INTO collectables (
       fingerprint, lightweight_fingerprint, kind, title, subtitle, description,
       primary_creator, creators, publishers, year, formats, system_name, tags, genre, runtime, identifiers,
       market_value, market_value_sources,
       images, cover_url, sources, external_id, fuzzy_fingerprints,
       cover_image_url, cover_image_source, attribution, metascore
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
     ON CONFLICT (fingerprint) DO UPDATE SET
       title = COALESCE(EXCLUDED.title, collectables.title),
       subtitle = COALESCE(EXCLUDED.subtitle, collectables.subtitle),
       description = COALESCE(EXCLUDED.description, collectables.description),
       primary_creator = COALESCE(EXCLUDED.primary_creator, collectables.primary_creator),
       creators = COALESCE(EXCLUDED.creators, collectables.creators),
       publishers = COALESCE(EXCLUDED.publishers, collectables.publishers),
       year = COALESCE(EXCLUDED.year, collectables.year),
       market_value = COALESCE(EXCLUDED.market_value, collectables.market_value),
       market_value_sources = COALESCE(EXCLUDED.market_value_sources, collectables.market_value_sources),
       formats = (
         SELECT to_jsonb(ARRAY(
           SELECT DISTINCT value
           FROM (
             SELECT jsonb_array_elements_text(COALESCE(collectables.formats, '[]'::jsonb)) AS value
             UNION
             SELECT jsonb_array_elements_text(COALESCE(EXCLUDED.formats, '[]'::jsonb)) AS value
           ) AS merged
           WHERE value IS NOT NULL AND value <> ''
         ))
       ),
       system_name = COALESCE(EXCLUDED.system_name, collectables.system_name),
       tags = COALESCE(EXCLUDED.tags, collectables.tags),
       genre = COALESCE(EXCLUDED.genre, collectables.genre),
       runtime = COALESCE(EXCLUDED.runtime, collectables.runtime),
       identifiers = collectables.identifiers || EXCLUDED.identifiers,
       images = COALESCE(EXCLUDED.images, collectables.images),
       cover_url = COALESCE(EXCLUDED.cover_url, collectables.cover_url),
       sources = collectables.sources || EXCLUDED.sources,
       fuzzy_fingerprints = COALESCE(EXCLUDED.fuzzy_fingerprints, collectables.fuzzy_fingerprints),
       cover_image_url = COALESCE(EXCLUDED.cover_image_url, collectables.cover_image_url),
       cover_image_source = COALESCE(EXCLUDED.cover_image_source, collectables.cover_image_source),
       attribution = COALESCE(EXCLUDED.attribution, collectables.attribution),
       metascore = COALESCE(EXCLUDED.metascore, collectables.metascore),
       updated_at = NOW()
     RETURNING *`,
        [
            fingerprint, lightweightFingerprint, normalizedKind, title, subtitle, description,
            resolvedPrimaryCreator, normalizedCreators, publishers, year, formatsJson, systemName, tags, normalizedGenre, normalizedRuntime,
            identifiersJson, normalizeString(marketValue) || null, marketValueSourcesJson, imagesJson, resolvedCoverUrl, sourcesJson, externalId,
            fuzzyFingerprintsJson, coverImageUrl, coverImageSource,
            attributionJson,
            metascoreJson
        ]
    );
    const collectable = rowToCamelCase(result.rows[0]);
    const isInsert = collectable.createdAt && collectable.updatedAt &&
      new Date(collectable.createdAt).getTime() === new Date(collectable.updatedAt).getTime();
    logger.info('[collectables] upsert', {
      action: isInsert ? 'insert' : 'update',
      collectableId: collectable.id,
      fingerprint: collectable.fingerprint,
      kind: normalizedKind,
      title: collectable.title,
    });
    const jobId = getJobId();
    if (jobId !== 'no-job') {
        appendJobEvent({
            jobId,
            level: 'info',
            message: '[collectables] upsert',
            userId: getUserId(),
            metadata: {
                action: isInsert ? 'insert' : 'update',
                collectableId: collectable.id,
                fingerprint: collectable.fingerprint,
                kind: normalizedKind,
                title: collectable.title,
            },
        }).catch((err) => {
            if (err && err.code === '42P01') return;
            logger.warn('[collectables] failed to append job event', { error: err.message });
        });
    }

    try {
        const coverMedia = await ensureCoverMediaForCollectable({
            collectableId: collectable.id,
            coverMediaId: collectable.coverMediaId,
            images,
            coverUrl: resolvedCoverUrl,
            kind: normalizedKind,
            title,
            coverImageSource,
        }, client);
        if (coverMedia?.id) {
            collectable.coverMediaId = coverMedia.id;
            if (coverMedia.localPath) {
                collectable.coverMediaPath = coverMedia.localPath;
            }
        }
        if (collectable.coverMediaId && !collectable.coverMediaPath) {
            const mediaResult = await q(
                'SELECT local_path FROM media WHERE id = $1',
                [collectable.coverMediaId],
            );
            const localPath = mediaResult.rows[0]?.local_path || null;
            if (localPath) collectable.coverMediaPath = localPath;
        }
    } catch (err) {
        logger.warn('[collectables.upsert] media sync failed', {
            collectableId: collectable.id,
            title: collectable.title || title || null,
            sourceUrl: resolvedCoverUrl || null,
            kind: normalizedKind,
            error: err.message || String(err),
        });
    }

    return collectable;
}

/**
 * Search in global catalog with optional kind filter
 */
async function searchGlobal({ q, kind, limit = 20, offset = 0 }) {
    const normalizedQuery = normalizeSearchText(q);
    const normalizedTitleExpr = buildNormalizedSqlExpression('c.title');
    const normalizedCreatorExpr = buildNormalizedSqlExpression('COALESCE(c.primary_creator, \'\')');

    let sql = `
    SELECT c.*, 
           similarity(c.title, $1) as title_sim,
           similarity(COALESCE(c.primary_creator, ''), $1) as creator_sim,
           GREATEST(
             similarity(c.title, $1),
             similarity(COALESCE(c.primary_creator, ''), $1),
             similarity(${normalizedTitleExpr}, $2),
             similarity(${normalizedCreatorExpr}, $2)
           ) as search_score,
           m.local_path as cover_media_path
    FROM collectables c
    LEFT JOIN media m ON m.id = c.cover_media_id
    WHERE c.title % $1
       OR COALESCE(c.primary_creator, '') % $1
       OR ${normalizedTitleExpr} % $2
       OR ${normalizedCreatorExpr} % $2
  `;
    const params = [q, normalizedQuery];

    const normalizedKind = kind ? normalizeCollectableKind(kind) : null;
    if (normalizedKind) {
        sql += ` AND c.kind = $${params.length + 1}`;
        params.push(normalizedKind);
    }

    sql += ` ORDER BY search_score DESC`;
    sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows.map(rowToCamelCase);
}

/**
 * Search in global catalog using wildcard ILIKE patterns
 * Use * as wildcard character (converted to % for SQL)
 */
async function searchGlobalWildcard({ pattern, kind, limit = 20, offset = 0 }) {
    // Convert * to % for SQL ILIKE
    const sqlPattern = pattern.replace(/\*/g, '%');
    const normalizedPattern = normalizeSearchWildcardPattern(pattern);
    const normalizedTitleExpr = buildNormalizedSqlExpression('c.title');
    const normalizedCreatorExpr = buildNormalizedSqlExpression('COALESCE(c.primary_creator, \'\')');

    let sql = `
    SELECT c.*, m.local_path as cover_media_path
    FROM collectables c
    LEFT JOIN media m ON m.id = c.cover_media_id
    WHERE c.title ILIKE $1
       OR c.primary_creator ILIKE $1
       OR ${normalizedTitleExpr} ILIKE $2
       OR ${normalizedCreatorExpr} ILIKE $2
  `;
    const params = [sqlPattern, normalizedPattern];

    const normalizedKind = kind ? normalizeCollectableKind(kind) : null;
    if (normalizedKind) {
        sql += ` AND c.kind = $${params.length + 1}`;
        params.push(normalizedKind);
    }

    sql += ` ORDER BY c.title ASC`;
    sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows.map(rowToCamelCase);
}

/**
 * Find a collectable using fuzzy matching on title and creator.
 * Uses PostgreSQL pg_trgm extension for similarity matching.
 * 
 * @param {string} title - Item title to match
 * @param {string} primaryCreator - Creator/author to match
 * @param {string} kind - Type filter (book, game, movie)
 * @param {number} threshold - Minimum similarity score (0.0-1.0), default 0.3
 * @returns {Promise<Object|null>} Best matching collectable or null
 */
async function fuzzyMatch(title, primaryCreator, kind, threshold = 0.3) {
    if (!title) return null;
    const normalizedTitle = normalizeSearchText(title);
    const normalizedCreator = normalizeSearchText(primaryCreator || '');
    const normalizedTitleExpr = buildNormalizedSqlExpression('c.title');
    const normalizedCreatorExpr = buildNormalizedSqlExpression('COALESCE(c.primary_creator, \'\')');

    let sql = `
    SELECT c.*,
           GREATEST(
             similarity(c.title, $1),
             similarity(${normalizedTitleExpr}, $3)
           ) AS title_sim,
           GREATEST(
             similarity(COALESCE(c.primary_creator, ''), $2),
             similarity(${normalizedCreatorExpr}, $4)
           ) AS creator_sim,
           (
             GREATEST(similarity(c.title, $1), similarity(${normalizedTitleExpr}, $3)) * 0.7 +
             GREATEST(similarity(COALESCE(c.primary_creator, ''), $2), similarity(${normalizedCreatorExpr}, $4)) * 0.3
           ) AS combined_sim,
           m.local_path as cover_media_path
    FROM collectables c
    LEFT JOIN media m ON m.id = c.cover_media_id
    WHERE similarity(c.title, $1) > $5
       OR similarity(${normalizedTitleExpr}, $3) > $5
  `;
    const params = [title, primaryCreator || '', normalizedTitle, normalizedCreator, threshold];

    const normalizedKind = kind ? normalizeCollectableKind(kind) : null;
    if (normalizedKind) {
        sql += ` AND c.kind = $6`;
        params.push(normalizedKind);
    }

    sql += ` ORDER BY combined_sim DESC LIMIT 1`;

    const result = await query(sql, params);

    if (result.rows.length && result.rows[0].combined_sim >= threshold) {
        return rowToCamelCase(result.rows[0]);
    }
    return null;
}

/**
 * Find collectable by fuzzy fingerprint (searches the fuzzy_fingerprints array)
 * Used to match raw OCR text that was previously cleaned up by enrichment.
 */
async function findByFuzzyFingerprint(fuzzyFp) {
    if (!fuzzyFp) return null;
    const result = await query(
        `SELECT c.*, m.local_path as cover_media_path
         FROM collectables c
         LEFT JOIN media m ON m.id = c.cover_media_id
         WHERE c.fuzzy_fingerprints @> $1::jsonb`,
        [JSON.stringify([fuzzyFp])]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Find collectable by name search using trigram similarity.
 * Returns the best match if it meets the similarity threshold.
 * Useful for movies/TV where director is not visible on spine - matches by title only.
 *
 * @param {string} title - Item title to search for
 * @param {string} kind - Type filter (book, game, movie, tv)
 * @param {number} threshold - Minimum similarity score (0.0-1.0), default 0.4
 * @returns {Promise<Object|null>} Best matching collectable or null
 */
async function findByNameSearch(title, kind, threshold = 0.4) {
    if (!title) return null;
    const results = await searchByTitle(title, kind, 1);
    if (results.length > 0 && results[0].sim >= threshold) {
        return results[0];
    }
    return null;
}

/**
 * Add a fuzzy fingerprint to an existing collectable's fuzzy_fingerprints array.
 * This is used to store raw OCR hashes that map to this collectable.
 */
async function addFuzzyFingerprint(collectableId, fuzzyFp) {
    if (!collectableId || !fuzzyFp) return null;
    const result = await query(
        `UPDATE collectables 
         SET fuzzy_fingerprints = CASE 
             WHEN fuzzy_fingerprints @> $2::jsonb THEN fuzzy_fingerprints
             ELSE fuzzy_fingerprints || $2::jsonb
         END,
         updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [collectableId, JSON.stringify([fuzzyFp])]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

module.exports = {
    findByFingerprint,
    findByLightweightFingerprint,
    findByFuzzyFingerprint,
    findByNameSearch,
    findBySourceId,
    findById,
    searchByTitle,
    upsert,
    searchGlobal,
    searchGlobalWildcard,
    fuzzyMatch,
    addFuzzyFingerprint,
};
