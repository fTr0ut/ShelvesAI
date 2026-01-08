const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

/**
 * Find collectable by fingerprint
 */
async function findByFingerprint(fingerprint) {
    if (!fingerprint) return null;
    const result = await query(
        'SELECT * FROM collectables WHERE fingerprint = $1',
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
        'SELECT * FROM collectables WHERE lightweight_fingerprint = $1',
        [lwf]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Find collectable by ID
 */
async function findById(id) {
    const result = await query(
        'SELECT * FROM collectables WHERE id = $1',
        [id]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Search collectables by title using trigram similarity
 */
async function searchByTitle(term, kind = null, limit = 20) {
    let sql = `
    SELECT *, similarity(title, $1) as sim
    FROM collectables
    WHERE title % $1
  `;
    const params = [term];

    if (kind) {
        sql += ` AND kind = $2`;
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
        tags = [],
        identifiers = {},
        images = [],
        coverUrl,
        sources = [],
        externalId,
        fuzzyFingerprints = [],
    } = data;

    const result = await query(
        `INSERT INTO collectables (
       fingerprint, lightweight_fingerprint, kind, title, subtitle, description,
       primary_creator, creators, publishers, year, tags, identifiers,
       images, cover_url, sources, external_id, fuzzy_fingerprints
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (fingerprint) DO UPDATE SET
       title = COALESCE(EXCLUDED.title, collectables.title),
       subtitle = COALESCE(EXCLUDED.subtitle, collectables.subtitle),
       description = COALESCE(EXCLUDED.description, collectables.description),
       primary_creator = COALESCE(EXCLUDED.primary_creator, collectables.primary_creator),
       creators = COALESCE(EXCLUDED.creators, collectables.creators),
       publishers = COALESCE(EXCLUDED.publishers, collectables.publishers),
       year = COALESCE(EXCLUDED.year, collectables.year),
       tags = COALESCE(EXCLUDED.tags, collectables.tags),
       identifiers = collectables.identifiers || EXCLUDED.identifiers,
       images = COALESCE(EXCLUDED.images, collectables.images),
       cover_url = COALESCE(EXCLUDED.cover_url, collectables.cover_url),
       sources = collectables.sources || EXCLUDED.sources,
       fuzzy_fingerprints = COALESCE(EXCLUDED.fuzzy_fingerprints, collectables.fuzzy_fingerprints),
       updated_at = NOW()
     RETURNING *`,
        [
            fingerprint, lightweightFingerprint, kind, title, subtitle, description,
            primaryCreator, creators, publishers, year, tags, JSON.stringify(identifiers),
            JSON.stringify(images), coverUrl, JSON.stringify(sources), externalId,
            JSON.stringify(fuzzyFingerprints)
        ]
    );
    return rowToCamelCase(result.rows[0]);
}

/**
 * Search in global catalog with optional kind filter
 */
async function searchGlobal({ q, kind, limit = 20, offset = 0 }) {
    let sql = `
    SELECT *, 
           similarity(title, $1) as title_sim,
           similarity(primary_creator, $1) as creator_sim
    FROM collectables
    WHERE title % $1 OR primary_creator % $1
  `;
    const params = [q];

    if (kind) {
        sql += ` AND kind = $${params.length + 1}`;
        params.push(kind);
    }

    sql += ` ORDER BY GREATEST(similarity(title, $1), similarity(primary_creator, $1)) DESC`;
    sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows.map(rowToCamelCase);
}

module.exports = {
    findByFingerprint,
    findByLightweightFingerprint,
    findById,
    searchByTitle,
    upsert,
    searchGlobal,
};
