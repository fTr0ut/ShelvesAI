const express = require('express');
const { auth } = require('../middleware/auth');
const { validateStringLengths } = require('../middleware/validate');
const feedQueries = require('../database/queries/feed');
const collectablesQueries = require('../database/queries/collectables');
const { query } = require('../database/pg');
const { rowToCamelCase } = require('../database/queries/utils');
const logger = require('../logger');
const collectablesRoute = require('./collectables');
const {
    normalizeSearchText,
    normalizeSearchWildcardPattern,
    buildNormalizedSqlExpression,
} = require('../utils/searchNormalization');

const router = express.Router();

router.use(auth);
const normalizedCollectableTitleExpr = buildNormalizedSqlExpression('c.title');
const normalizedCollectableCreatorExpr = buildNormalizedSqlExpression('COALESCE(c.primary_creator, \'\')');
const normalizedManualTitleExpr = buildNormalizedSqlExpression('um.name');
const normalizedManualCreatorExpr = buildNormalizedSqlExpression('COALESCE(um.author, \'\')');
const {
    parseBooleanFlag: parseCollectablesBooleanFlag,
    parseFallbackLimit: parseCollectablesFallbackLimit,
    computeFallbackFetchLimit: computeCollectablesFallbackFetchLimit,
    fetchFallbackResultsWithCache,
    resolveApiContainerForSearch,
    MIN_FALLBACK_QUERY_LENGTH: MIN_COLLECTABLES_FALLBACK_QUERY_LENGTH = 3,
} = collectablesRoute._helpers || {};

function normalizeTextValue(value) {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
}

function normalizePlatformData(value) {
    if (value == null) return [];
    const source = Array.isArray(value) ? value : [value];
    const out = [];
    const seen = new Set();
    for (const entry of source) {
        if (!entry || typeof entry !== 'object') continue;
        const igdbPlatformIdRaw = entry.igdbPlatformId ?? entry.igdb_platform_id ?? entry.id ?? null;
        const parsedIgdbPlatformId = parseInt(igdbPlatformIdRaw, 10);
        const igdbPlatformId = Number.isFinite(parsedIgdbPlatformId) ? parsedIgdbPlatformId : null;
        const name = normalizeTextValue(entry.name);
        const abbreviation = normalizeTextValue(entry.abbreviation || entry.abbr);
        if (!name && !abbreviation) continue;
        const normalizedEntry = {
            provider: normalizeTextValue(entry.provider || entry.source),
            igdbPlatformId,
            name: name || null,
            abbreviation: abbreviation || null,
            sourceType: normalizeTextValue(entry.sourceType || entry.source_type),
            releaseDate: normalizeTextValue(entry.releaseDate || entry.release_date),
            releaseDateHuman: normalizeTextValue(entry.releaseDateHuman || entry.release_date_human),
            releaseRegion: normalizeTextValue(entry.releaseRegion || entry.release_region),
            releaseRegionName: normalizeTextValue(entry.releaseRegionName || entry.release_region_name),
        };
        const key = [
            normalizedEntry.igdbPlatformId != null ? String(normalizedEntry.igdbPlatformId) : '',
            String(normalizedEntry.name || '').toLowerCase(),
            String(normalizedEntry.abbreviation || '').toLowerCase(),
            String(normalizedEntry.sourceType || '').toLowerCase(),
            String(normalizedEntry.releaseRegion || '').toLowerCase(),
            String(normalizedEntry.releaseDate || '').toLowerCase(),
        ].join('::');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalizedEntry);
    }
    return out;
}

function derivePlatformNames({ platformData = [], systemName = null }) {
    const out = [];
    const seen = new Set();
    const push = (value) => {
        const normalized = normalizeTextValue(value);
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(normalized);
    };

    platformData.forEach((entry) => {
        push(entry?.name);
        push(entry?.abbreviation);
    });
    push(systemName);
    return out;
}

function buildGamePlatformFilterClause(paramRef) {
    return `(
        LOWER(COALESCE(c.system_name, '')) LIKE ${paramRef}
        OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(c.platform_data, '[]'::jsonb)) AS pd
            WHERE LOWER(COALESCE(pd->>'name', '')) LIKE ${paramRef}
               OR LOWER(COALESCE(pd->>'abbreviation', '')) LIKE ${paramRef}
        )
    )`;
}

function parseFallbackBoolean(value, defaultValue = false) {
    if (typeof parseCollectablesBooleanFlag === 'function') {
        return parseCollectablesBooleanFlag(value, defaultValue);
    }
    if (value === undefined || value === null || value === '') return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parseFallbackLimit(value) {
    if (typeof parseCollectablesFallbackLimit === 'function') {
        return parseCollectablesFallbackLimit(value);
    }
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 3;
    return Math.min(parsed, 50);
}

function computeFallbackFetchLimit({ fallbackLimit, limit }) {
    if (typeof computeCollectablesFallbackFetchLimit === 'function') {
        return computeCollectablesFallbackFetchLimit({ fallbackLimit, limit });
    }
    const normalizedFallback = parseFallbackLimit(fallbackLimit);
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? limit : 20;
    const requested = normalizedLimit + 1;
    return Math.min(50, Math.max(1, Math.min(normalizedFallback, requested)));
}

function buildCheckinSearchDedupKey(entry) {
    if (!entry || typeof entry !== 'object') return null;

    const source = String(entry.source || '').trim().toLowerCase();
    if (source === 'manual' && entry.id != null) {
        return `manual:${entry.id}`;
    }
    if ((source === 'collectable' || source === 'local') && entry.id != null) {
        return `collectable:${entry.id}`;
    }

    const provider = String(entry.provider || entry.source || entry._source || 'api').trim().toLowerCase();
    const externalId = String(entry.externalId || entry.external_id || '').trim();
    if (externalId) return `${provider}:ext:${externalId}`;

    const kind = String(entry.kind || entry.type || '').trim().toLowerCase();
    const title = String(entry.title || entry.name || '').trim().toLowerCase();
    const creator = String(entry.primaryCreator || entry.author || '').trim().toLowerCase();
    if (!title) return null;
    return `${kind}|${title}|${creator}`;
}

function mergeCheckinSearchResults(localResults = [], apiResults = [], limit = 20) {
    const merged = [];
    const seen = new Set();
    const max = Number.isFinite(limit) && limit > 0 ? limit : 20;

    const addEntry = (entry) => {
        if (!entry || typeof entry !== 'object') return;
        const key = buildCheckinSearchDedupKey(entry);
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        merged.push(entry);
    };

    localResults.forEach(addEntry);
    apiResults.forEach(addEntry);
    return merged.slice(0, max);
}

function buildCheckinSearchQuery({ q, userId, limit, useWildcard, platformFilterNeedle = null }) {
    const hasPlatformFilter = !!platformFilterNeedle;

    if (useWildcard && q.includes('*')) {
        const sqlPattern = q.replace(/\*/g, '%');
        const normalizedPattern = normalizeSearchWildcardPattern(q);
        const params = [sqlPattern, normalizedPattern, userId];
        const platformRef = hasPlatformFilter ? `$${params.length + 1}` : null;
        if (hasPlatformFilter) {
            params.push(platformFilterNeedle);
        }
        const limitRef = `$${params.length + 1}`;
        params.push(limit);
        return {
            sql: `
        SELECT id, title, primary_creator, kind, cover_url, cover_media_path, source, system_name, platform_data
        FROM (
          SELECT c.id, c.title, c.primary_creator, c.kind, c.cover_url,
                 m.local_path as cover_media_path, 'collectable' as source,
                 c.system_name,
                 c.platform_data,
                 c.title as sort_title
          FROM collectables c
          LEFT JOIN media m ON m.id = c.cover_media_id
          WHERE (
            c.title ILIKE $1
            OR c.primary_creator ILIKE $1
            OR ${normalizedCollectableTitleExpr} ILIKE $2
            OR ${normalizedCollectableCreatorExpr} ILIKE $2
          )
          ${hasPlatformFilter ? `AND ${buildGamePlatformFilterClause(platformRef)}` : ''}
          UNION ALL
          SELECT um.id, um.name as title, um.author as primary_creator, COALESCE(um.type, 'manual') as kind,
                 NULL::text as cover_url, NULL::text as cover_media_path, 'manual' as source,
                 NULL::text as system_name,
                 NULL::jsonb as platform_data,
                 um.name as sort_title
          FROM user_manuals um
          WHERE um.user_id = $3
            AND (
              um.name ILIKE $1
              OR um.author ILIKE $1
              OR ${normalizedManualTitleExpr} ILIKE $2
              OR ${normalizedManualCreatorExpr} ILIKE $2
            )
        ) results
        ORDER BY sort_title ASC
        LIMIT ${limitRef}`,
            params,
        };
    }

    const normalizedQuery = normalizeSearchText(q);
    const params = [q, normalizedQuery, userId];
    const platformRef = hasPlatformFilter ? `$${params.length + 1}` : null;
    if (hasPlatformFilter) {
        params.push(platformFilterNeedle);
    }
    const limitRef = `$${params.length + 1}`;
    params.push(limit);
    return {
        sql: `
        SELECT id, title, primary_creator, kind, cover_url, cover_media_path, source, system_name, platform_data
        FROM (
          SELECT c.id, c.title, c.primary_creator, c.kind, c.cover_url,
                 m.local_path as cover_media_path, 'collectable' as source,
                 c.system_name,
                 c.platform_data,
                 GREATEST(
                   similarity(c.title, $1),
                   similarity(COALESCE(c.primary_creator, ''), $1),
                   similarity(${normalizedCollectableTitleExpr}, $2),
                   similarity(${normalizedCollectableCreatorExpr}, $2)
                 ) AS score
          FROM collectables c
          LEFT JOIN media m ON m.id = c.cover_media_id
          WHERE (
            c.title % $1
            OR c.primary_creator % $1
            OR ${normalizedCollectableTitleExpr} % $2
            OR ${normalizedCollectableCreatorExpr} % $2
          )
          ${hasPlatformFilter ? `AND ${buildGamePlatformFilterClause(platformRef)}` : ''}
          UNION ALL
          SELECT um.id, um.name as title, um.author as primary_creator, COALESCE(um.type, 'manual') as kind,
                 NULL::text as cover_url, NULL::text as cover_media_path, 'manual' as source,
                 NULL::text as system_name,
                 NULL::jsonb as platform_data,
                 GREATEST(
                   similarity(um.name, $1),
                   similarity(COALESCE(um.author, ''), $1),
                   similarity(${normalizedManualTitleExpr}, $2),
                   similarity(${normalizedManualCreatorExpr}, $2)
                 ) AS score
          FROM user_manuals um
          WHERE um.user_id = $3
            AND (
              um.name % $1
              OR um.author % $1
              OR ${normalizedManualTitleExpr} % $2
              OR ${normalizedManualCreatorExpr} % $2
            )
        ) results
        ORDER BY score DESC NULLS LAST, title ASC
        LIMIT ${limitRef}`,
        params,
    };
}

/**
 * GET /api/checkin/search
 * Search catalog collectables plus the user's manual entries.
 *
 * Query: q (required), limit (optional), wildcard (optional)
 */
router.get('/search', validateStringLengths({ q: 500 }, { source: 'query' }), async (req, res) => {
    try {
        const userId = req.user.id;
        const q = String(req.query.q || '').trim();
        const limit = Math.min(parseInt(req.query.limit || '10', 10), 50);
        const useWildcard = String(req.query.wildcard || '').toLowerCase() === 'true';
        const fallbackApi = parseFallbackBoolean(req.query.fallbackApi, true);
        const fallbackLimit = parseFallbackLimit(req.query.fallbackLimit ?? String(limit));
        const apiSupplement = parseFallbackBoolean(req.query.apiSupplement, false);
        const rawType = String(req.query.type || '').trim();
        const platform = String(req.query.platform || '').trim();
        const explicitTypeProvided = !!rawType && rawType.toLowerCase() !== 'all';
        const normalizedRawType = explicitTypeProvided ? rawType.trim().toLowerCase() : '';
        const minFallbackQueryLength = Number.isFinite(MIN_COLLECTABLES_FALLBACK_QUERY_LENGTH)
            ? MIN_COLLECTABLES_FALLBACK_QUERY_LENGTH
            : 3;
        const resolvedContainerForLocal = platform
            ? await resolveApiContainerForSearch({
                explicitType: explicitTypeProvided ? rawType : '',
                queryText: q,
                userId: req.user?.id || null,
            })
            : null;
        const shouldFilterLocalGames = !!platform && (
            normalizedRawType === 'games'
            || (!normalizedRawType && resolvedContainerForLocal === 'games')
        );
        const platformFilterNeedle = shouldFilterLocalGames ? `%${platform.toLowerCase()}%` : null;

        if (!q) {
            return res.json({ results: [] });
        }

        const { sql, params } = buildCheckinSearchQuery({
            q,
            userId,
            limit,
            useWildcard,
            platformFilterNeedle,
        });
        const result = await query(sql, params);
        const localResults = result.rows.map(rowToCamelCase).map((entry) => {
            const systemName = normalizeTextValue(entry.systemName || entry.system_name) || null;
            const platformData = normalizePlatformData(entry.platformData || entry.platform_data);
            return {
                ...entry,
                systemName,
                platformData,
                platforms: derivePlatformNames({ platformData, systemName }),
                fromApi: false,
                source: entry.source || 'collectable',
            };
        });

        let apiResults = [];
        let resolvedContainer = null;
        let searchedApi = false;
        const canSearchApi = fallbackApi && q.length >= minFallbackQueryLength;
        const shouldFallbackOnZeroResults = canSearchApi && localResults.length === 0;
        const shouldSupplementLocalResults = canSearchApi && apiSupplement && localResults.length > 0;
        if (
            (shouldFallbackOnZeroResults || shouldSupplementLocalResults)
            && typeof fetchFallbackResultsWithCache === 'function'
            && typeof resolveApiContainerForSearch === 'function'
        ) {
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
                    fallbackLimit: computeFallbackFetchLimit({ fallbackLimit, limit }),
                    fallbackOffset: 0,
                    platform,
                });
            }
        }

        let finalResults = localResults;
        if (localResults.length === 0 && apiResults.length) {
            finalResults = apiResults.slice(0, limit);
        } else if (shouldSupplementLocalResults) {
            finalResults = mergeCheckinSearchResults(localResults, apiResults, limit);
        }

        res.json({
            results: finalResults,
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
        logger.error('GET /api/checkin/search error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/checkin
 * Create a check-in event for the authenticated user
 * 
 * Body: {
 *   collectableId: number (required when manualId absent) - ID of the collectable
 *   manualId: number (required when collectableId absent) - ID of the user's manual entry
 *   status: 'starting' | 'continuing' | 'completed' (required)
 *   visibility: 'public' | 'friends' (optional, defaults to 'public')
 *   note: string (optional) - user message/comment
 * }
 */
router.post('/', validateStringLengths({ note: 5000 }), async (req, res) => {
    try {
        const userId = req.user.id;
        const { collectableId, manualId, status, visibility = 'public', note } = req.body || {};

        // Validate required fields
        if (!collectableId && !manualId) {
            return res.status(400).json({ error: 'collectableId or manualId is required' });
        }
        if (collectableId && manualId) {
            return res.status(400).json({ error: 'collectableId and manualId cannot both be set' });
        }
        if (!status) {
            return res.status(400).json({ error: 'status is required' });
        }

        let collectable = null;
        let manual = null;

        if (collectableId) {
            // Verify the collectable exists
            collectable = await collectablesQueries.findById(collectableId);
            if (!collectable) {
                return res.status(404).json({ error: 'Collectable not found' });
            }
        } else {
            const manualResult = await query(
                'SELECT * FROM user_manuals WHERE id = $1 AND user_id = $2',
                [manualId, userId]
            );
            manual = manualResult.rows[0] ? rowToCamelCase(manualResult.rows[0]) : null;
            if (!manual) {
                return res.status(404).json({ error: 'Manual item not found' });
            }
        }

        // Create the check-in event
        const event = await feedQueries.logCheckIn({
            userId,
            collectableId: collectable?.id || null,
            manualId: manual?.id || null,
            status,
            visibility,
            note: note?.trim() || null,
        });

        res.status(201).json({
            event: {
                id: event.id,
                eventType: event.eventType,
                status: event.checkinStatus,
                visibility: event.visibility,
                note: event.note,
                createdAt: event.createdAt,
                collectable: collectable ? {
                    id: collectable.id,
                    title: collectable.title,
                    primaryCreator: collectable.primaryCreator,
                    coverUrl: collectable.coverUrl,
                    coverMediaPath: collectable.coverMediaPath,
                    kind: collectable.kind,
                } : null,
                manual: manual ? {
                    id: manual.id,
                    title: manual.name,
                    primaryCreator: manual.author || null,
                    kind: manual.type || 'manual',
                } : null,
                source: manual ? 'manual' : 'collectable',
            },
        });
    } catch (err) {
        logger.error('POST /api/checkin error:', err);
        if (err.message?.includes('required') || err.message?.includes('Invalid')) {
            return res.status(400).json({ error: err.message });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
module.exports._buildCheckinSearchQuery = buildCheckinSearchQuery;
module.exports._helpers = {
    buildCheckinSearchDedupKey,
    mergeCheckinSearchResults,
};
