const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');
const { ensureCoverMediaForCollectable } = require('./media');

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
    let sql = `
    SELECT c.*, similarity(c.title, $1) as sim, m.local_path as cover_media_path
    FROM collectables c
    LEFT JOIN media m ON m.id = c.cover_media_id
    WHERE c.title % $1
  `;
    const params = [term];

    if (kind) {
        sql += ` AND c.kind = $2`;
        params.push(kind);
    }

    sql += ` ORDER BY sim DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);
    return result.rows.map(rowToCamelCase);
}

/**
 * Upsert a collectable (insert or update on conflict)
 */
async function upsert(data) {
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
        format,
        formats,
        systemName,
        tags = [],
        identifiers = {},
        images = [],
        coverUrl,
        sources = [],
        externalId,
        fuzzyFingerprints = [],
        coverImageUrl,
        coverImageSource = 'external',
        attribution = null,
    } = data;

    const resolvedCoverUrl = pickCoverUrl(images, coverUrl);
    const normalizedFormats = normalizeFormats(formats, format);

    const result = await query(
        `INSERT INTO collectables (
       fingerprint, lightweight_fingerprint, kind, title, subtitle, description,
       primary_creator, creators, publishers, year, formats, system_name, tags, identifiers,
       images, cover_url, sources, external_id, fuzzy_fingerprints,
       cover_image_url, cover_image_source, attribution
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
     ON CONFLICT (fingerprint) DO UPDATE SET
       title = COALESCE(EXCLUDED.title, collectables.title),
       subtitle = COALESCE(EXCLUDED.subtitle, collectables.subtitle),
       description = COALESCE(EXCLUDED.description, collectables.description),
       primary_creator = COALESCE(EXCLUDED.primary_creator, collectables.primary_creator),
       creators = COALESCE(EXCLUDED.creators, collectables.creators),
       publishers = COALESCE(EXCLUDED.publishers, collectables.publishers),
       year = COALESCE(EXCLUDED.year, collectables.year),
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
       identifiers = collectables.identifiers || EXCLUDED.identifiers,
       images = COALESCE(EXCLUDED.images, collectables.images),
       cover_url = COALESCE(EXCLUDED.cover_url, collectables.cover_url),
       sources = collectables.sources || EXCLUDED.sources,
       fuzzy_fingerprints = COALESCE(EXCLUDED.fuzzy_fingerprints, collectables.fuzzy_fingerprints),
       cover_image_url = COALESCE(EXCLUDED.cover_image_url, collectables.cover_image_url),
       cover_image_source = COALESCE(EXCLUDED.cover_image_source, collectables.cover_image_source),
       attribution = COALESCE(EXCLUDED.attribution, collectables.attribution),
       updated_at = NOW()
     RETURNING *`,
        [
            fingerprint, lightweightFingerprint, kind, title, subtitle, description,
            primaryCreator, creators, publishers, year, JSON.stringify(normalizedFormats), systemName, tags, JSON.stringify(identifiers),
            JSON.stringify(images), resolvedCoverUrl, JSON.stringify(sources), externalId,
            JSON.stringify(fuzzyFingerprints), coverImageUrl, coverImageSource,
            attribution ? JSON.stringify(attribution) : null
        ]
    );
    const collectable = rowToCamelCase(result.rows[0]);

    try {
        const coverMedia = await ensureCoverMediaForCollectable({
            collectableId: collectable.id,
            coverMediaId: collectable.coverMediaId,
            images,
            coverUrl: resolvedCoverUrl,
            kind,
            title,
            coverImageSource,
        });
        if (coverMedia?.id) {
            collectable.coverMediaId = coverMedia.id;
            if (coverMedia.localPath) {
                collectable.coverMediaPath = coverMedia.localPath;
            }
        }
        if (collectable.coverMediaId && !collectable.coverMediaPath) {
            const mediaResult = await query(
                'SELECT local_path FROM media WHERE id = $1',
                [collectable.coverMediaId],
            );
            const localPath = mediaResult.rows[0]?.local_path || null;
            if (localPath) collectable.coverMediaPath = localPath;
        }
    } catch (err) {
        console.warn('[collectables.upsert] media sync failed:', err.message || err);
    }

    return collectable;
}

/**
 * Search in global catalog with optional kind filter
 */
async function searchGlobal({ q, kind, limit = 20, offset = 0 }) {
    let sql = `
    SELECT c.*, 
           similarity(c.title, $1) as title_sim,
           similarity(c.primary_creator, $1) as creator_sim,
           m.local_path as cover_media_path
    FROM collectables c
    LEFT JOIN media m ON m.id = c.cover_media_id
    WHERE c.title % $1 OR c.primary_creator % $1
  `;
    const params = [q];

    if (kind) {
        sql += ` AND c.kind = $${params.length + 1}`;
        params.push(kind);
    }

    sql += ` ORDER BY GREATEST(similarity(c.title, $1), similarity(c.primary_creator, $1)) DESC`;
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

    let sql = `
    SELECT c.*, m.local_path as cover_media_path
    FROM collectables c
    LEFT JOIN media m ON m.id = c.cover_media_id
    WHERE c.title ILIKE $1 OR c.primary_creator ILIKE $1
  `;
    const params = [sqlPattern];

    if (kind) {
        sql += ` AND c.kind = $${params.length + 1}`;
        params.push(kind);
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

    let sql = `
    SELECT c.*,
           similarity(c.title, $1) AS title_sim,
           similarity(COALESCE(c.primary_creator, ''), $2) AS creator_sim,
           (similarity(c.title, $1) * 0.7 + similarity(COALESCE(c.primary_creator, ''), $2) * 0.3) AS combined_sim,
           m.local_path as cover_media_path
    FROM collectables c
    LEFT JOIN media m ON m.id = c.cover_media_id
    WHERE similarity(c.title, $1) > $3
  `;
    const params = [title, primaryCreator || '', threshold];

    if (kind) {
        sql += ` AND c.kind = $4`;
        params.push(kind);
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
    findById,
    searchByTitle,
    upsert,
    searchGlobal,
    searchGlobalWildcard,
    fuzzyMatch,
    addFuzzyFingerprint,
};
