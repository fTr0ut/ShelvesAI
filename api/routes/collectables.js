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
const { getCollectableMatchingService } = require('../services/collectableMatchingService');
const { resolveShelfType } = require('../services/config/shelfTypeResolver');
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
const API_CONTAINER_TYPES = new Set(['books', 'movies', 'games', 'tv', 'vinyl']);
const DEFAULT_API_CONTAINER_TYPE = 'books';
const DEFAULT_FALLBACK_LIMIT = 3;
const MAX_FALLBACK_LIMIT = 50;
const MIN_FALLBACK_QUERY_LENGTH = 3;
const FALLBACK_CACHE_TTL_MS = (() => {
  const raw = parseInt(process.env.COLLECTABLES_FALLBACK_CACHE_TTL_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 120000;
})();
const MAX_FALLBACK_CACHE_ENTRIES = (() => {
  const raw = parseInt(process.env.COLLECTABLES_FALLBACK_CACHE_MAX_ENTRIES || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 300;
})();
const CREATOR_ONLY_FALLBACK_TYPES = new Set(['books', 'vinyl', 'movies', 'games']);
const fallbackSearchCache = new Map();
const fallbackSearchInFlight = new Map();

function categoryToKind(category) {
  return CATEGORY_TO_KIND[category?.toLowerCase()] || 'other';
}

function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parseFallbackLimit(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FALLBACK_LIMIT;
  return Math.min(parsed, MAX_FALLBACK_LIMIT);
}

function computeFallbackFetchLimit({ fallbackLimit, limit }) {
  const normalizedFallback = parseFallbackLimit(fallbackLimit);
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? limit : 20;
  const requested = normalizedLimit + 1; // fetch one extra to infer hasMore
  return Math.min(MAX_FALLBACK_LIMIT, Math.max(1, Math.min(normalizedFallback, requested)));
}

function normalizeExplicitType(rawType) {
  const trimmed = String(rawType || '').trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase() === 'all') return '';
  return normalizeCollectableKind(trimmed);
}

function normalizeApiContainerType(value) {
  const kind = normalizeCollectableKind(value);
  if (!kind) return null;
  return API_CONTAINER_TYPES.has(kind) ? kind : null;
}

function normalizeArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeTextValue(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function parseRuntime(value) {
  if (value == null || value === '') return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStructuredQueryForCreator(queryText) {
  const text = normalizeTextValue(queryText);
  if (!text) return null;

  const patterns = [
    /^\s*(?<title>.+?)\s+(?:directed\s+by|dir\.?)\s+(?<creator>.+?)\s*$/i,
    /^\s*(?<title>.+?)\s+(?:by|from|feat\.?|ft\.?)\s+(?<creator>.+?)\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const title = normalizeTextValue(match?.groups?.title);
    const creator = normalizeTextValue(match?.groups?.creator);
    if (title && creator) {
      return { title, creator };
    }
  }

  return null;
}

function buildCreatorLookupPayload(creatorText) {
  const creator = normalizeTextValue(creatorText);
  if (!creator) return null;
  return {
    title: '',
    name: '',
    primaryCreator: creator,
    author: creator,
    creator,
    director: creator,
    developer: creator,
    artist: creator,
  };
}

function buildApiLookupInputs({ queryText, resolvedContainer, platform }) {
  const normalizedQuery = normalizeTextValue(queryText);
  if (!normalizedQuery) return [];
  const normalizedContainer = String(resolvedContainer || '').trim().toLowerCase();
  const normalizedPlatform = normalizedContainer === 'games' ? normalizeTextValue(platform) : null;
  const addPlatform = (payload) => {
    if (!normalizedPlatform) return payload;
    return {
      ...payload,
      platform: normalizedPlatform,
      systemName: normalizedPlatform,
    };
  };

  const structured = parseStructuredQueryForCreator(normalizedQuery);
  if (structured) {
    const creatorPayload = buildCreatorLookupPayload(structured.creator) || {};
    return [addPlatform({
      ...creatorPayload,
      title: structured.title,
      name: structured.title,
    })];
  }

  const inputs = [addPlatform({
    title: normalizedQuery,
    name: normalizedQuery,
  })];

  if (CREATOR_ONLY_FALLBACK_TYPES.has(String(resolvedContainer || '').trim().toLowerCase())) {
    const creatorPayload = buildCreatorLookupPayload(normalizedQuery);
    if (creatorPayload) inputs.push(addPlatform(creatorPayload));
  }

  return inputs;
}

function buildFallbackCacheKey({ queryText, resolvedContainer, fallbackLimit, fallbackOffset = 0, platform = '' }) {
  const normalizedContainer = String(resolvedContainer || '').trim().toLowerCase();
  const normalizedPlatform = normalizedContainer === 'games'
    ? String(platform || '').trim().toLowerCase()
    : '';
  return [
    normalizedContainer,
    String(queryText || '').trim().toLowerCase(),
    normalizedPlatform,
    String(fallbackLimit || DEFAULT_FALLBACK_LIMIT),
    String(fallbackOffset || 0),
  ].join('::');
}

function getCachedFallbackResults(cacheKey) {
  const cached = fallbackSearchCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    fallbackSearchCache.delete(cacheKey);
    return null;
  }
  return cached.results;
}

function setCachedFallbackResults(cacheKey, results) {
  if (fallbackSearchCache.size >= MAX_FALLBACK_CACHE_ENTRIES) {
    const oldestKey = fallbackSearchCache.keys().next().value;
    if (oldestKey) fallbackSearchCache.delete(oldestKey);
  }

  fallbackSearchCache.set(cacheKey, {
    results,
    expiresAt: Date.now() + FALLBACK_CACHE_TTL_MS,
  });
}

async function fetchFallbackResultsWithCache({ queryText, resolvedContainer, fallbackLimit, fallbackOffset = 0, platform = '' }) {
  const cacheKey = buildFallbackCacheKey({ queryText, resolvedContainer, fallbackLimit, fallbackOffset, platform });
  const cached = getCachedFallbackResults(cacheKey);
  if (cached) return cached;

  if (fallbackSearchInFlight.has(cacheKey)) {
    return fallbackSearchInFlight.get(cacheKey);
  }

  const run = (async () => {
    const matchingService = getCollectableMatchingService();
    const lookupInputs = buildApiLookupInputs({ queryText, resolvedContainer, platform });
    if (!lookupInputs.length) return [];

    const batchedMatches = await Promise.all(
      lookupInputs.map((lookupInput) => (
        matchingService.searchCatalogAPIMultiple(
          lookupInput,
          resolvedContainer,
          { limit: fallbackLimit, offset: fallbackOffset },
        )
      )),
    );
    const externalMatches = mergeSearchResults([], batchedMatches.flat(), fallbackLimit);

    const mapped = externalMatches.map((entry) => {
      const provider = String(entry?.provider || entry?._source || 'api').toLowerCase();
      return {
        ...omitMarketValueSources(entry),
        fromApi: true,
        source: provider,
        provider,
      };
    });

    setCachedFallbackResults(cacheKey, mapped);
    return mapped;
  })();

  fallbackSearchInFlight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    fallbackSearchInFlight.delete(cacheKey);
  }
}

function buildSearchResultDedupKey(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.id != null) return `id:${entry.id}`;

  const provider = String(entry.provider || entry.source || entry._source || 'api').trim().toLowerCase();
  const externalId = String(entry.externalId || entry.external_id || '').trim();
  if (externalId) return `${provider}:ext:${externalId}`;

  const kind = String(entry.kind || entry.type || '').trim().toLowerCase();
  const title = String(entry.title || entry.name || '').trim().toLowerCase();
  const creator = String(entry.primaryCreator || entry.author || '').trim().toLowerCase();
  if (!title) return null;
  return `${kind}|${title}|${creator}`;
}

function mergeSearchResults(localResults = [], apiResults = [], limit = 20) {
  const merged = [];
  const seen = new Set();
  const max = Number.isFinite(limit) && limit > 0 ? limit : 20;

  const addEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const key = buildSearchResultDedupKey(entry);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    merged.push(entry);
  };

  localResults.forEach(addEntry);
  apiResults.forEach(addEntry);
  return merged.slice(0, max);
}

async function resolveDominantShelfTypeForUser(userId) {
  if (!userId) return null;
  const result = await query(
    `SELECT s.type, COUNT(*)::int AS count
     FROM user_collections uc
     JOIN shelves s ON s.id = uc.shelf_id
     WHERE uc.user_id = $1
       AND s.type = ANY($2::text[])
     GROUP BY s.type
     ORDER BY count DESC, s.type ASC
     LIMIT 1`,
    [userId, Array.from(API_CONTAINER_TYPES)],
  );
  return result.rows[0]?.type || null;
}

async function resolveApiContainerForSearch({ explicitType = '', queryText = '', userId = null }) {
  const explicit = normalizeApiContainerType(explicitType);
  if (explicitType) return explicit;

  const inferred = resolveShelfType(queryText);
  if (API_CONTAINER_TYPES.has(inferred)) return inferred;

  const dominantType = await resolveDominantShelfTypeForUser(userId);
  if (API_CONTAINER_TYPES.has(dominantType)) return dominantType;

  return DEFAULT_API_CONTAINER_TYPE;
}

function buildCollectableUpsertPayloadFromCandidate(candidate, fallbackKind) {
  const title = normalizeTextValue(candidate?.title || candidate?.name);
  if (!title) return null;

  const primaryCreator = normalizeTextValue(candidate?.primaryCreator || candidate?.author);
  const kind = normalizeCollectableKind(
    candidate?.kind || candidate?.type || fallbackKind || DEFAULT_API_CONTAINER_TYPE,
    fallbackKind || DEFAULT_API_CONTAINER_TYPE,
  );
  const year = normalizeTextValue(candidate?.year || candidate?.releaseYear);
  const marketValue = normalizeTextValue(candidate?.marketValue || candidate?.market_value);
  const marketValueSources = normalizeSourceLinks(candidate?.marketValueSources || candidate?.market_value_sources);
  const genre = normalizeStringArray(candidate?.genre ?? candidate?.genres);
  const publishers = normalizeStringArray(candidate?.publisher ?? candidate?.publishers);
  const formats = normalizeStringArray(candidate?.format ?? candidate?.formats);
  const tags = normalizeTags(candidate?.tags || candidate?.genre || candidate?.genres);
  const coverUrl = normalizeTextValue(
    candidate?.coverUrl ||
    candidate?.cover_url ||
    candidate?.coverImageUrl ||
    candidate?.coverImage ||
    candidate?.image,
  );
  const coverImageUrl = normalizeTextValue(candidate?.coverImageUrl || candidate?.cover_image_url);
  const coverImageSource = normalizeTextValue(candidate?.coverImageSource || candidate?.cover_image_source) || 'external';
  const externalId = normalizeTextValue(candidate?.externalId || candidate?.external_id);
  const identifiers = candidate?.identifiers && typeof candidate.identifiers === 'object' && !Array.isArray(candidate.identifiers)
    ? candidate.identifiers
    : {};
  const images = normalizeArray(candidate?.images).filter(Boolean);
  const provider = normalizeTextValue(candidate?.provider || candidate?._source || candidate?.source);
  const sources = normalizeArray(candidate?.sources).filter(Boolean);
  if (provider && !sources.some((entry) => String(entry).toLowerCase() === provider.toLowerCase())) {
    sources.push(provider);
  }

  const fingerprint = candidate?.fingerprint || makeCollectableFingerprint({
    title,
    primaryCreator: primaryCreator || null,
    releaseYear: year || null,
    mediaType: kind,
  });
  const lightweightFingerprint = candidate?.lightweightFingerprint || makeLightweightFingerprint({
    title,
    primaryCreator: primaryCreator || null,
    kind,
  });

  return {
    fingerprint,
    lightweightFingerprint,
    kind,
    title,
    primaryCreator,
    description: normalizeTextValue(candidate?.description),
    year,
    marketValue,
    marketValueSources,
    publishers,
    formats,
    tags,
    genre: genre.length ? genre : null,
    runtime: parseRuntime(candidate?.runtime),
    identifiers,
    images,
    coverUrl,
    coverImageUrl,
    coverImageSource,
    attribution: candidate?.attribution && typeof candidate.attribution === 'object' ? candidate.attribution : null,
    externalId,
    sources,
  };
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
    const type = normalizeExplicitType(rawType);
    const platform = normalizeTextValue(req.query.platform);
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });
    const useWildcard = String(req.query.wildcard || '').toLowerCase() === 'true';
    const fallbackApi = parseBooleanFlag(req.query.fallbackApi);
    const fallbackLimit = parseFallbackLimit(req.query.fallbackLimit);
    const apiSupplement = parseBooleanFlag(req.query.apiSupplement);

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
        results: result.rows.map(rowToCamelCase).map(omitMarketValueSources).map((entry) => ({
          ...entry,
          fromApi: false,
          source: 'local',
        })),
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + result.rows.length < total,
          count: result.rows.length,
        },
        searched: {
          local: true,
          api: false,
        },
        sources: {
          localCount: result.rows.length,
          apiCount: 0,
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
    const total = parseInt(countResult.rows[0].total, 10);
    const localResults = results.map(omitMarketValueSources).map((entry) => ({
      ...entry,
      fromApi: false,
      source: 'local',
    }));

    let apiResults = [];
    let resolvedContainer = null;
    let searchedApi = false;
    const canSearchApi = (
      fallbackApi
      && q.length >= MIN_FALLBACK_QUERY_LENGTH
    );
    const shouldFallbackOnZeroResults = canSearchApi && localResults.length === 0;
    const shouldSupplementLocalResults = canSearchApi && apiSupplement && localResults.length > 0 && offset === 0;
    const fallbackFetchLimit = computeFallbackFetchLimit({
      fallbackLimit,
      limit,
    });
    if (shouldFallbackOnZeroResults || shouldSupplementLocalResults) {
      const explicitTypeProvided = !!rawType && rawType.toLowerCase() !== 'all';
      resolvedContainer = await resolveApiContainerForSearch({
        explicitType: explicitTypeProvided ? rawType : '',
        queryText: q,
        userId: req.user?.id || null,
      });

      if (resolvedContainer) {
        searchedApi = true;
        apiResults = await fetchFallbackResultsWithCache({
          queryText: q,
          resolvedContainer,
          fallbackLimit: fallbackFetchLimit,
          fallbackOffset: shouldFallbackOnZeroResults ? offset : 0,
          platform,
        });
      }
    }

    let finalResults = localResults;
    let finalTotal = total;
    let hasMore = offset + localResults.length < total;
    if (localResults.length === 0) {
      finalResults = apiResults.slice(0, limit);
      hasMore = apiResults.length > limit;
      finalTotal = offset + finalResults.length + (hasMore ? 1 : 0);
    } else if (shouldSupplementLocalResults) {
      finalResults = mergeSearchResults(localResults, apiResults, limit);
      finalTotal = total + apiResults.length;
      hasMore = offset + finalResults.length < finalTotal;
    }

    return res.json({
      results: finalResults,
      pagination: {
        limit,
        offset,
        total: finalTotal,
        hasMore,
        count: finalResults.length,
      },
      searched: {
        local: true,
        api: searchedApi,
      },
      resolvedContainer,
      sources: {
        localCount: localResults.length,
        apiCount: apiResults.length,
      },
    });
  } catch (err) {
    logger.error('GET /collectables error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Resolve and upsert a tapped API search hit to a canonical collectable
router.post("/resolve-search-hit", async (req, res) => {
  try {
    const candidate = req.body?.candidate || req.body?.collectable || req.body?.result || null;
    if (!candidate || typeof candidate !== 'object') {
      return res.status(400).json({ error: 'candidate object is required' });
    }

    const selectedType = normalizeTextValue(req.body?.selectedType || req.body?.type) || '';
    const explicitType = selectedType
      || normalizeTextValue(candidate?.kind || candidate?.type)
      || '';
    const queryTitle = normalizeTextValue(candidate?.title || candidate?.name || req.body?.q || req.body?.query) || '';

    const resolvedContainer = await resolveApiContainerForSearch({
      explicitType,
      queryText: queryTitle,
      userId: req.user?.id || null,
    });

    const matchingService = getCollectableMatchingService();
    let resolvedCandidate = { ...candidate };
    if (resolvedContainer) {
      const apiResult = await matchingService.searchCatalogAPI(
        {
          ...candidate,
          title: normalizeTextValue(candidate?.title || candidate?.name),
          name: normalizeTextValue(candidate?.name || candidate?.title),
          primaryCreator: normalizeTextValue(candidate?.primaryCreator || candidate?.author),
          author: normalizeTextValue(candidate?.author || candidate?.primaryCreator),
        },
        resolvedContainer,
      );
      if (apiResult) {
        resolvedCandidate = { ...resolvedCandidate, ...apiResult };
      }
    }

    const upsertPayload = buildCollectableUpsertPayloadFromCandidate(
      resolvedCandidate,
      resolvedContainer || DEFAULT_API_CONTAINER_TYPE,
    );
    if (!upsertPayload) {
      return res.status(400).json({ error: 'candidate title is required' });
    }

    const saved = await collectablesQueries.upsert(upsertPayload);
    const hydrated = saved?.id ? await collectablesQueries.findById(saved.id) : saved;

    return res.status(201).json({
      collectable: omitMarketValueSources(hydrated || saved),
      resolvedContainer,
    });
  } catch (err) {
    logger.error('POST /collectables/resolve-search-hit error:', err);
    return res.status(500).json({ error: 'Server error' });
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

// Get market value sources for a collectable (or manual via ?type=manual)
router.get("/:collectableId/market-value-sources", validateIntParam(['collectableId']), async (req, res) => {
  try {
    const itemId = parseInt(req.params.collectableId, 10);
    const isManual = req.query.type === 'manual';
    const table = isManual ? 'user_manuals' : 'collectables';
    const result = await query(
      `SELECT market_value_sources FROM ${table} WHERE id = $1`,
      [itemId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Item not found' });
    const sources = result.rows[0].market_value_sources || [];
    res.json({ sources });
  } catch (err) {
    logger.error('GET /collectables/:id/market-value-sources error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get the current user's market value estimate for a collectable (or manual via ?type=manual)
router.get("/:collectableId/user-estimate", validateIntParam(['collectableId']), async (req, res) => {
  try {
    const itemId = parseInt(req.params.collectableId, 10);
    const isManual = req.query.type === 'manual';
    const key = isManual ? { manualId: itemId } : { collectableId: itemId };
    const estimate = await marketValueEstimates.getEstimate(req.user.id, key);
    res.json({ estimate: estimate ? { value: estimate.estimateValue, updatedAt: estimate.updatedAt } : null });
  } catch (err) {
    logger.error('GET /collectables/:id/user-estimate error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create or update the current user's market value estimate (or manual via ?type=manual)
router.put("/:collectableId/user-estimate", validateIntParam(['collectableId']), async (req, res) => {
  try {
    const itemId = parseInt(req.params.collectableId, 10);
    const isManual = req.query.type === 'manual';
    const key = isManual ? { manualId: itemId } : { collectableId: itemId };
    const { estimateValue } = req.body || {};

    // Null or empty means delete
    if (estimateValue === null || estimateValue === undefined || (typeof estimateValue === 'string' && !estimateValue.trim())) {
      await marketValueEstimates.deleteEstimate(req.user.id, key);
      return res.json({ estimate: null });
    }

    if (typeof estimateValue !== 'string') {
      return res.status(400).json({ error: 'estimateValue must be a string' });
    }

    const saved = await marketValueEstimates.setEstimate(req.user.id, key, estimateValue);
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
module.exports._helpers = {
  normalizeExplicitType,
  normalizeApiContainerType,
  parseFallbackLimit,
  computeFallbackFetchLimit,
  parseStructuredQueryForCreator,
  buildApiLookupInputs,
  resolveApiContainerForSearch,
  buildCollectableUpsertPayloadFromCandidate,
};
