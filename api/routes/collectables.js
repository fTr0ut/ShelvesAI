const express = require("express");
const { auth } = require("../middleware/auth");
const collectablesQueries = require("../database/queries/collectables");
const { query } = require("../database/pg");
const { rowToCamelCase, parsePagination } = require("../database/queries/utils");
const { makeCollectableFingerprint, makeLightweightFingerprint } = require("../services/collectables/fingerprint");
const { normalizeCollectableKind } = require("../services/collectables/kind");

const router = express.Router();

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

function normalizeTags(input) {
  if (input == null) return [];
  const source = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[\s,]+/)
      : [];
  const seen = new Set();
  const tags = [];
  for (const entry of source) {
    const trimmed = String(entry ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(trimmed);
  }
  return tags;
}

function normalizeStringArray(input) {
  if (input == null) return [];
  const source = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[;,]+/)
      : [];
  const seen = new Set();
  const out = [];
  for (const entry of source) {
    const trimmed = String(entry ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function normalizeString(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

// Optional admin/dev only: create catalog item when ALLOW_CATALOG_WRITE=true
router.post("/", async (req, res) => {
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
      tags: normalizeTags(tags),
      genre: normalizedGenre.length ? normalizedGenre : null,
      runtime: resolvedRuntime,
    });

    res.status(201).json({ item });
  } catch (err) {
    console.error('POST /collectables error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Resolve a news item to a collectable (find existing or create minimal)
router.post("/from-news", async (req, res) => {
  try {
    const {
      externalId,
      sourceApi,
      title,
      category,
      primaryCreator,
      coverUrl,
      year,
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
      return res.json({ collectable: existing, source: 'existing' });
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
      description: normalizeString(description),
      genre: normalizedGenre.length ? normalizedGenre : null,
      runtime: resolvedRuntime,
      externalId: fullExternalId,
      identifiers,
      sources: parsedSource ? [parsedSource] : [],
    });

    res.status(201).json({ collectable: created, source: 'created' });
  } catch (err) {
    console.error('POST /collectables/from-news error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Search catalog globally
router.get("/", async (req, res) => {
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
        results: result.rows.map(rowToCamelCase),
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
      countSql = `SELECT COUNT(*) as total FROM collectables 
       WHERE (title ILIKE $1 OR primary_creator ILIKE $1)
       ${type ? 'AND kind = $2' : ''}`;
      countParams = type ? [sqlPattern, type] : [sqlPattern];
    } else {
      // Default: trigram similarity search
      results = await collectablesQueries.searchGlobal({ q, kind: type || null, limit, offset });
      countSql = `SELECT COUNT(*) as total FROM collectables 
       WHERE (title % $1 OR primary_creator % $1)
       ${type ? 'AND kind = $2' : ''}`;
      countParams = type ? [q, type] : [q];
    }

    const countResult = await query(countSql, countParams);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      results,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + results.length < total,
        count: results.length,
      },
    });
  } catch (err) {
    console.error('GET /collectables error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Retrieve a single collectable by id
router.get("/:collectableId", async (req, res) => {
  try {
    const collectable = await collectablesQueries.findById(parseInt(req.params.collectableId, 10));
    if (!collectable)
      return res.status(404).json({ error: "Collectable not found" });
    res.json({ collectable });
  } catch (err) {
    console.error('GET /collectables/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a collectable's core metadata
router.put("/:collectableId", async (req, res) => {
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
      return res.json({ collectable: rowToCamelCase(existingResult.rows[0]) });
    }

    values.push(collectableId);
    const result = await query(
      `UPDATE collectables SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    const updated = result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    const hydrated = updated ? await collectablesQueries.findById(updated.id) : null;
    res.json({ collectable: hydrated || updated });
  } catch (err) {
    console.error('PUT /collectables/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
