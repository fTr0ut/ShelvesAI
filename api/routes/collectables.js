const express = require("express");
const { auth } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/admin");
const { validateIntParam, validateStringLengths } = require("../middleware/validate");
const collectablesQueries = require("../database/queries/collectables");
const marketValueEstimates = require("../database/queries/marketValueEstimates");
const { query } = require("../database/pg");
const { rowToCamelCase, parsePagination } = require("../database/queries/utils");
const { makeCollectableFingerprint, makeLightweightFingerprint } = require("../services/collectables/fingerprint");
const { normalizeCollectableKind } = require("../services/collectables/kind");
const { normalizeString: _normalizeString, normalizeStringArray, normalizeTags } = require("../utils/normalize");
const logger = require('../logger');
const {
  normalizeSearchText,
  normalizeSearchWildcardPattern,
  buildNormalizedSqlExpression,
} = require('../utils/searchNormalization');

const router = express.Router();
const normalizedCollectableTitleExpr = buildNormalizedSqlExpression('title');
const normalizedCollectableCreatorExpr = buildNormalizedSqlExpression('COALESCE(primary_creator, \'\')');

router.use(auth);

// Category to kind mapping for news items
const CATEGORY_TO_KIND = {
  movies: 'movie',
  tv: 'tv',
  games: 'game',
  books: 'book',
  vinyl: 'album',
};

function categoryToKind(category) {
  return CATEGORY_TO_KIND[category?.toLowerCase()] || 'other';
}

/**
 * Local wrapper: the shared normalizeString returns null for empty values,
 * but this route file historically returned undefined. Keep that behaviour
 * for the routes in this file so response shapes are unchanged.
 */
function normalizeString(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function normalizeSourceLinks(value) {
  if (value == null) return [];
  const source = Array.isArray(value) ? value : [value];
  return source
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        const url = normalizeString(entry);
        return url ? { url } : null;
      }
      if (typeof entry === 'object') {
        const url = normalizeString(entry.url || entry.link || entry.href);
        if (!url) return null;
        const label = normalizeString(entry.label || entry.name || entry.title);
        return label ? { url, label } : { url };
      }
      return null;
    })
    .filter(Boolean);
}

function omitMarketValueSources(entity) {
  if (!entity || typeof entity !== 'object') return entity;
  const { marketValueSources, ...rest } = entity;
  return rest;
}

// Optional admin/dev only: create catalog item when ALLOW_CATALOG_WRITE=true
router.post("/", requireAdmin, async (req, res) => {
  try {
    if (String(process.env.ALLOW_CATALOG_WRITE).toLowerCase() !== "true") {
      return res.status(403).json({ error: "Catalog writes disabled" });
    }

    const {
      title,
      name,
      type,
      description,
      author,
      primaryCreator,
      format,
      formats,
      publisher,
      year,
      marketValue,
      marketValueSources,
      tags,
      genre,
      genres,
      runtime,
    } = req.body ?? {};

    const canonicalTitle = normalizeString(title ?? name);
    const canonicalType = normalizeCollectableKind(type, normalizeString(type));

    if (!canonicalTitle || !canonicalType)
      return res.status(400).json({ error: "title and type required" });

    const normalizedGenre = normalizeStringArray(genre ?? genres);
    const parsedRuntime = runtime === null ? null : parseInt(runtime, 10);
    const resolvedRuntime = Number.isFinite(parsedRuntime) ? parsedRuntime : null;

    const item = await collectablesQueries.upsert({
      title: canonicalTitle,
      kind: canonicalType,
      description: normalizeString(description),
      primaryCreator: normalizeString(primaryCreator ?? author),
      formats: Array.isArray(formats)
        ? formats.map(normalizeString).filter(Boolean)
        : format
          ? [normalizeString(format)]
          : [],
      publishers: publisher ? [normalizeString(publisher)] : [],
      year: normalizeString(year),
      marketValue: normalizeString(marketValue),
      marketValueSources: normalizeSourceLinks(marketValueSources),
      tags: normalizeTags(tags),
      genre: normalizedGenre.length ? normalizedGenre : null,
      runtime: resolvedRuntime,
    });

    res.status(201).json({ item: omitMarketValueSources(item) });
  } catch (err) {
    logger.error('POST /collectables error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Resolve a news item to a collectable (find existing or create minimal)
router.post("/from-news", requireAdmin, async (req, res) => {
  try {
    const {
      externalId,
      sourceApi,
      title,
      category,
      primaryCreator,
      coverUrl,
      year,
      marketValue,
      marketValueSources,
      description,
      genre,
      genres,
      runtime,
    } = req.body ?? {};

    // Validate required fields
    if (!externalId) {
      return res.status(400).json({ error: "externalId is required" });
    }
    if (!title) {
      return res.status(400).json({ error: "title is required" });
    }

    // Try to find existing collectable by source ID
    const existing = await collectablesQueries.findBySourceId(externalId, sourceApi);
    if (existing) {
      return res.json({ collectable: omitMarketValueSources(existing), source: 'existing' });
    }

    // Create a minimal collectable
    const kind = categoryToKind(category);

    // Parse the externalId to extract source and ID
    // Format: "tmdb:1054867" or "igdb:12345" or raw ID
    let parsedSource = sourceApi;
    let parsedId = externalId;
    if (!sourceApi && typeof externalId === 'string' && externalId.includes(':')) {
      const colonIndex = externalId.indexOf(':');
      parsedSource = externalId.slice(0, colonIndex);
      parsedId = externalId.slice(colonIndex + 1);
    }

    const fullExternalId = parsedSource ? `${parsedSource}:${parsedId}` : parsedId;

    // Build identifiers object matching the format used by CollectableDiscoveryHook
    const identifiers = {};
    if (parsedSource && parsedId) {
      // Use nested structure: { tmdb: { movie: ["1054867"] } }
      identifiers[parsedSource] = { [kind]: [String(parsedId)] };
    }

    // Generate proper SHA1 fingerprint using the fingerprint utility
    const fingerprint = makeCollectableFingerprint({
      title: normalizeString(title),
      primaryCreator: normalizeString(primaryCreator),
      releaseYear: normalizeString(year),
      mediaType: kind,
    });

    const lightweightFingerprint = makeLightweightFingerprint({
      title: normalizeString(title),
      primaryCreator: normalizeString(primaryCreator),
      kind,
    });

    const normalizedGenre = normalizeStringArray(genre ?? genres);
    const parsedRuntime = runtime === null ? null : parseInt(runtime, 10);
    const resolvedRuntime = Number.isFinite(parsedRuntime) ? parsedRuntime : null;

    const created = await collectablesQueries.upsert({
      fingerprint,
      lightweightFingerprint,
      kind,
      title: normalizeString(title),
      primaryCreator: normalizeString(primaryCreator),
      coverUrl: normalizeString(coverUrl),
      year: normalizeString(year),
      marketValue: normalizeString(marketValue),
      marketValueSources: normalizeSourceLinks(marketValueSources),
      description: normalizeString(description),
      genre: normalizedGenre.length ? normalizedGenre : null,
      runtime: resolvedRuntime,
      externalId: fullExternalId,
      identifiers,
      sources: parsedSource ? [parsedSource] : [],
    });

    res.status(201).json({ collectable: omitMarketValueSources(created), source: 'created' });
  } catch (err) {
    logger.error('POST /collectables/from-news error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Search catalog globally
router.get("/", validateStringLengths({ q: 500 }, { source: 'query' }), async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const rawType = String(req.query.type || "").trim();
    const type = rawType ? normalizeCollectableKind(rawType) : "";
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });
    const useWildcard = String(req.query.wildcard || '').toLowerCase() === 'true';

    if (!q) {
      // Return paginated list without search
      const result = await query(
        `SELECT * FROM collectables 
         ${type ? 'WHERE kind = $1' : ''}
         ORDER BY created_at DESC
         LIMIT $${type ? 2 : 1} OFFSET $${type ? 3 : 2}`,
        type ? [type, limit, offset] : [limit, offset]
      );

      const countResult = await query(
        `SELECT COUNT(*) as total FROM collectables ${type ? 'WHERE kind = $1' : ''}`,
        type ? [type] : []
      );
      const total = parseInt(countResult.rows[0].total);

      return res.json({
        results: result.rows.map(rowToCamelCase).map(omitMarketValueSources),
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + result.rows.length < total,
          count: result.rows.length,
        },
      });
    }

    let results;
    let countSql;
    let countParams;

    if (useWildcard && q.includes('*')) {
      // Wildcard mode: use ILIKE pattern matching
      results = await collectablesQueries.searchGlobalWildcard({ pattern: q, kind: type || null, limit, offset });
      const sqlPattern = q.replace(/\*/g, '%');
      const normalizedPattern = normalizeSearchWildcardPattern(q);
      countSql = `SELECT COUNT(*) as total FROM collectables 
       WHERE (
         title ILIKE $1
         OR primary_creator ILIKE $1
         OR ${normalizedCollectableTitleExpr} ILIKE $2
         OR ${normalizedCollectableCreatorExpr} ILIKE $2
       )
       ${type ? 'AND kind = $3' : ''}`;
      countParams = type ? [sqlPattern, normalizedPattern, type] : [sqlPattern, normalizedPattern];
    } else {
      // Default: trigram similarity search
      results = await collectablesQueries.searchGlobal({ q, kind: type || null, limit, offset });
      const normalizedQuery = normalizeSearchText(q);
      countSql = `SELECT COUNT(*) as total FROM collectables 
       WHERE (
         title % $1
         OR primary_creator % $1
         OR ${normalizedCollectableTitleExpr} % $2
         OR ${normalizedCollectableCreatorExpr} % $2
       )
       ${type ? 'AND kind = $3' : ''}`;
      countParams = type ? [q, normalizedQuery, type] : [q, normalizedQuery];
    }

    const countResult = await query(countSql, countParams);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      results: results.map(omitMarketValueSources),
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + results.length < total,
        count: results.length,
      },
    });
  } catch (err) {
    logger.error('GET /collectables error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Retrieve a single collectable by id
router.get("/:collectableId", validateIntParam(['collectableId']), async (req, res) => {
  try {
    const collectable = await collectablesQueries.findById(parseInt(req.params.collectableId, 10));
    if (!collectable)
      return res.status(404).json({ error: "Collectable not found" });
    res.json({ collectable: omitMarketValueSources(collectable) });
  } catch (err) {
    logger.error('GET /collectables/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get market value sources for a collectable
router.get("/:collectableId/market-value-sources", validateIntParam(['collectableId']), async (req, res) => {
  try {
    const collectableId = parseInt(req.params.collectableId, 10);
    const result = await query(
      'SELECT market_value_sources FROM collectables WHERE id = $1',
      [collectableId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Collectable not found' });
    const sources = result.rows[0].market_value_sources || [];
    res.json({ sources });
  } catch (err) {
    logger.error('GET /collectables/:id/market-value-sources error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get the current user's market value estimate for a collectable
router.get("/:collectableId/user-estimate", validateIntParam(['collectableId']), async (req, res) => {
  try {
    const collectableId = parseInt(req.params.collectableId, 10);
    const estimate = await marketValueEstimates.getEstimate(req.user.id, { collectableId });
    res.json({ estimate: estimate ? { value: estimate.estimateValue, updatedAt: estimate.updatedAt } : null });
  } catch (err) {
    logger.error('GET /collectables/:id/user-estimate error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create or update the current user's market value estimate for a collectable
router.put("/:collectableId/user-estimate", validateIntParam(['collectableId']), async (req, res) => {
  try {
    const collectableId = parseInt(req.params.collectableId, 10);
    const { estimateValue } = req.body || {};

    // Null or empty means delete
    if (estimateValue === null || estimateValue === undefined || (typeof estimateValue === 'string' && !estimateValue.trim())) {
      await marketValueEstimates.deleteEstimate(req.user.id, { collectableId });
      return res.json({ estimate: null });
    }

    if (typeof estimateValue !== 'string') {
      return res.status(400).json({ error: 'estimateValue must be a string' });
    }

    const saved = await marketValueEstimates.setEstimate(req.user.id, { collectableId }, estimateValue);
    res.json({ estimate: saved ? { value: saved.estimateValue, updatedAt: saved.updatedAt } : null });
  } catch (err) {
    logger.error('PUT /collectables/:id/user-estimate error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a collectable's core metadata
router.put("/:collectableId", requireAdmin, validateIntParam(['collectableId']), async (req, res) => {
  try {
    const collectableId = parseInt(req.params.collectableId, 10);
    const existingResult = await query('SELECT * FROM collectables WHERE id = $1', [collectableId]);

    if (!existingResult.rows.length) {
      return res.status(404).json({ error: "Collectable not found" });
    }

    const body = req.body ?? {};
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (body.title !== undefined || body.name !== undefined) {
      const nextTitle = normalizeString(body.title ?? body.name);
      if (!nextTitle)
        return res.status(400).json({ error: "title cannot be empty" });
      updates.push(`title = $${paramIndex++}`);
      values.push(nextTitle);
    }

    if (body.primaryCreator !== undefined || body.author !== undefined) {
      updates.push(`primary_creator = $${paramIndex++}`);
      values.push(normalizeString(body.primaryCreator ?? body.author));
    }

    if (body.publisher !== undefined) {
      updates.push(`publishers = $${paramIndex++}`);
      values.push(body.publisher ? [normalizeString(body.publisher)] : []);
    }

    if (body.formats !== undefined || body.format !== undefined) {
      const normalizedFormats = Array.isArray(body.formats)
        ? body.formats.map(normalizeString).filter(Boolean)
        : body.format
          ? [normalizeString(body.format)]
          : [];
      updates.push(`formats = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(normalizedFormats));
    }

    if (body.year !== undefined) {
      updates.push(`year = $${paramIndex++}`);
      values.push(normalizeString(body.year));
    }

    if (body.marketValue !== undefined || body.market_value !== undefined) {
      updates.push(`market_value = $${paramIndex++}`);
      values.push(normalizeString(body.marketValue ?? body.market_value));
    }

    if (body.marketValueSources !== undefined || body.market_value_sources !== undefined) {
      updates.push(`market_value_sources = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(normalizeSourceLinks(body.marketValueSources ?? body.market_value_sources)));
    }

    if (body.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(normalizeTags(body.tags));
    }

    if (body.genre !== undefined || body.genres !== undefined) {
      const normalizedGenre = normalizeStringArray(body.genre ?? body.genres);
      updates.push(`genre = $${paramIndex++}`);
      values.push(normalizedGenre);
    }

    if (body.runtime !== undefined) {
      const parsedRuntime = body.runtime === null ? null : parseInt(body.runtime, 10);
      updates.push(`runtime = $${paramIndex++}`);
      values.push(Number.isFinite(parsedRuntime) ? parsedRuntime : null);
    }

    if (!updates.length) {
      return res.json({ collectable: omitMarketValueSources(rowToCamelCase(existingResult.rows[0])) });
    }

    values.push(collectableId);
    const result = await query(
      `UPDATE collectables SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    const updated = result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    const hydrated = updated ? await collectablesQueries.findById(updated.id) : null;
    res.json({ collectable: omitMarketValueSources(hydrated || updated) });
  } catch (err) {
    logger.error('PUT /collectables/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
