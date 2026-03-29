import { useCallback, useRef, useState } from 'react';
import { apiRequest } from '../services/api';
import { normalizeSearchText } from '../utils/searchNormalization';

export const COLLECTABLE_SEARCH_TYPE_OPTIONS = [
    { label: 'All', value: '' },
    { label: 'Books', value: 'books' },
    { label: 'Movies', value: 'movies' },
    { label: 'Games', value: 'games' },
    { label: 'TV', value: 'tv' },
    { label: 'Vinyl', value: 'vinyl' },
];

export const MIN_FALLBACK_QUERY_LENGTH = 3;
export const DEFAULT_COLLECTABLE_SEARCH_LIMIT = 20;
export const DEFAULT_API_FALLBACK_RESULTS_LIMIT = 25;

const DEBUG_ENABLED = __DEV__;
const DEFAULT_DEBUG_QUERY_ALLOWLIST = ['christopher nolan'];
const MAX_DEBUG_ITEMS = 40;

function normalizeCollectableField(value) {
    return normalizeSearchText(value || '');
}

function tokenizeNormalizedText(value) {
    const normalized = normalizeCollectableField(value);
    if (!normalized) return [];
    return normalized.split(' ').filter(Boolean);
}

function canonicalizeCollectableKind(value) {
    const normalized = normalizeCollectableField(value);
    if (!normalized) return '';
    if (normalized === 'book' || normalized === 'books') return 'book';
    if (normalized === 'movie' || normalized === 'movies' || normalized === 'film' || normalized === 'films') return 'movie';
    if (normalized === 'game' || normalized === 'games') return 'game';
    if (normalized === 'tv' || normalized === 'show' || normalized === 'shows' || normalized === 'series') return 'tv';
    if (normalized === 'vinyl' || normalized === 'album' || normalized === 'albums' || normalized === 'record' || normalized === 'records') return 'vinyl';
    return normalized;
}

function getNormalizedCollectableKind(item) {
    return canonicalizeCollectableKind(item?.kind || item?.type);
}

function getNormalizedCollectableTitle(item) {
    return normalizeCollectableField(item?.title || item?.name);
}

function getNormalizedCollectableCreator(item) {
    return normalizeCollectableField(item?.primaryCreator || item?.author);
}

function buildExactDedupeKey(item) {
    const kind = getNormalizedCollectableKind(item);
    const title = getNormalizedCollectableTitle(item);
    const creator = getNormalizedCollectableCreator(item);
    if (!kind || !title || !creator) return null;
    return `${kind}|${title}|${creator}`;
}

function buildKindTitleKey(item) {
    const kind = getNormalizedCollectableKind(item);
    const title = getNormalizedCollectableTitle(item);
    if (!kind || !title) return null;
    return `${kind}|${title}`;
}

function areCreatorStringsEquivalent(a, b) {
    const creatorA = normalizeCollectableField(a);
    const creatorB = normalizeCollectableField(b);
    if (!creatorA || !creatorB) return false;
    if (creatorA === creatorB) return true;

    const tokensA = tokenizeNormalizedText(creatorA);
    const tokensB = tokenizeNormalizedText(creatorB);
    if (!tokensA.length || !tokensB.length) return false;

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    const aContainsB = tokensB.every((token) => setA.has(token));
    const bContainsA = tokensA.every((token) => setB.has(token));
    return aContainsB || bContainsA;
}

function buildIdentityKey(item) {
    if (!item || typeof item !== 'object') return null;
    if (item?.id != null) return `id:${item.id}`;

    const provider = String(item?.source || item?.provider || 'api').trim().toLowerCase();
    const externalId = String(item?.externalId || item?.external_id || '').trim();
    if (externalId) return `${provider}:ext:${externalId}`;

    return buildExactDedupeKey(item);
}

function isStrongCreatorQueryMatch(creatorValue, normalizedQuery, queryTokens) {
    const creator = normalizeCollectableField(creatorValue);
    if (!creator || !normalizedQuery) return false;
    if (creator === normalizedQuery) return true;

    if (!queryTokens.length) return false;
    const creatorTokens = tokenizeNormalizedText(creator);
    if (!creatorTokens.length) return false;
    const creatorTokenSet = new Set(creatorTokens);
    if (queryTokens.length === 1) {
        return creatorTokenSet.has(queryTokens[0]);
    }
    return queryTokens.every((token) => creatorTokenSet.has(token));
}

function computeQualitySignals(item, normalizedQuery, queryTokens) {
    const title = getNormalizedCollectableTitle(item);
    const creator = getNormalizedCollectableCreator(item);
    const creatorMatch = isStrongCreatorQueryMatch(creator, normalizedQuery, queryTokens);

    const hasQueryTokens = Array.isArray(queryTokens) && queryTokens.length > 0;
    let queryTokenCoverage = 0;
    if (hasQueryTokens && title) {
        queryTokenCoverage = queryTokens.filter((token) => title.includes(token)).length;
    }
    const titleContainsMostQueryTokens = hasQueryTokens
        ? queryTokenCoverage >= Math.ceil(queryTokens.length * 0.7)
        : false;
    const titleContainsFullQuery = !!normalizedQuery && !!title && title.includes(normalizedQuery);
    const titleLikelyQueryMeta = titleContainsFullQuery || titleContainsMostQueryTokens;
    const titleStartsWithUntitled = !!title && title.startsWith('untitled');

    let qualityScore = 0;
    if (creatorMatch) qualityScore += 10;
    if (!titleLikelyQueryMeta) qualityScore += 2;
    if (titleLikelyQueryMeta) qualityScore -= 3;
    if (titleStartsWithUntitled) qualityScore -= 4;

    return {
        creatorMatch,
        titleLikelyQueryMeta,
        titleStartsWithUntitled,
        qualityScore,
    };
}

function getMatchTier(item, normalizedQuery, queryTokens) {
    if (!normalizedQuery) return 3;
    const title = getNormalizedCollectableTitle(item);
    const creator = getNormalizedCollectableCreator(item);
    const titleExact = !!title && title === normalizedQuery;
    const creatorExact = isStrongCreatorQueryMatch(creator, normalizedQuery, queryTokens);

    if (titleExact && creatorExact) return 0;
    if (titleExact) return 1;
    if (creatorExact) return 2;
    return 3;
}

function shouldLogDebug(searchText, allowlist = DEFAULT_DEBUG_QUERY_ALLOWLIST) {
    if (!DEBUG_ENABLED) return false;
    const normalized = normalizeCollectableField(searchText);
    if (!normalized) return false;
    if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
    return allowlist.some((entry) => normalized.includes(normalizeCollectableField(entry)));
}

function logDebug(tag, label, payload) {
    if (!DEBUG_ENABLED || !tag) return;
    try {
        console.log(`[${tag}] ${label}`, JSON.stringify(payload));
    } catch (_err) {
        console.log(`[${tag}] ${label}`, payload);
    }
}

function toDebugItem(entry, index, extras = {}) {
    return {
        index,
        source: entry?.fromApi ? 'api' : 'local',
        id: entry?.id ?? null,
        externalId: entry?.externalId ?? entry?.external_id ?? null,
        kind: entry?.kind || entry?.type || null,
        title: entry?.title || entry?.name || null,
        creator: entry?.primaryCreator || entry?.author || null,
        normKind: getNormalizedCollectableKind(entry) || null,
        normTitle: getNormalizedCollectableTitle(entry) || null,
        normCreator: getNormalizedCollectableCreator(entry) || null,
        exactKey: buildExactDedupeKey(entry),
        kindTitleKey: buildKindTitleKey(entry),
        identityKey: buildIdentityKey(entry),
        ...extras,
    };
}

function processIncomingItems(previous, incoming, searchText, debugConfig = {}) {
    const debugEnabled = shouldLogDebug(searchText, debugConfig.queryAllowlist);
    const seenExact = new Set();
    const seenIdentity = new Set();
    const seenKindTitleCreators = new Map();
    const dropped = [];

    const rememberCreatorForKindTitle = (entry) => {
        const kindTitleKey = buildKindTitleKey(entry);
        const creator = getNormalizedCollectableCreator(entry);
        if (!kindTitleKey || !creator) return;
        const existingCreators = seenKindTitleCreators.get(kindTitleKey) || [];
        if (!existingCreators.some((existing) => existing === creator)) {
            existingCreators.push(creator);
            seenKindTitleCreators.set(kindTitleKey, existingCreators);
        }
    };

    previous.forEach((entry) => {
        const exactKey = buildExactDedupeKey(entry);
        const identityKey = buildIdentityKey(entry);
        if (exactKey) seenExact.add(exactKey);
        if (identityKey) seenIdentity.add(identityKey);
        rememberCreatorForKindTitle(entry);
    });

    const incomingLocal = [];
    const incomingApi = [];
    incoming.forEach((entry) => {
        if (entry?.fromApi) incomingApi.push(entry);
        else incomingLocal.push(entry);
    });

    const normalizedQuery = normalizeCollectableField(searchText);
    const queryTokens = tokenizeNormalizedText(normalizedQuery);
    const scoredIncomingLocal = incomingLocal.map((entry, index) => ({
        entry,
        index,
        tier: getMatchTier(entry, normalizedQuery, queryTokens),
        signals: computeQualitySignals(entry, normalizedQuery, queryTokens),
    }));
    const incomingLocalPreferred = scoredIncomingLocal.filter((wrapped) => wrapped.tier <= 2);
    const incomingLocalWeak = scoredIncomingLocal.filter((wrapped) => wrapped.tier > 2);

    const sortedIncomingApiWrapped = incomingApi
        .map((entry, index) => ({
            entry,
            index,
            tier: getMatchTier(entry, normalizedQuery, queryTokens),
            signals: computeQualitySignals(entry, normalizedQuery, queryTokens),
        }))
        .sort((a, b) => {
            if (a.tier !== b.tier) return a.tier - b.tier;
            if ((a.signals?.qualityScore || 0) !== (b.signals?.qualityScore || 0)) {
                return (b.signals?.qualityScore || 0) - (a.signals?.qualityScore || 0);
            }
            return a.index - b.index;
        });

    const transformedIncoming = [
        ...incomingLocalPreferred.map((wrapped) => wrapped.entry),
        ...sortedIncomingApiWrapped.map((wrapped) => wrapped.entry),
        ...incomingLocalWeak.map((wrapped) => wrapped.entry),
    ];

    const appended = [];
    transformedIncoming.forEach((entry, idx) => {
        const exactKey = buildExactDedupeKey(entry);
        const identityKey = buildIdentityKey(entry);
        const kindTitleKey = buildKindTitleKey(entry);
        const creator = getNormalizedCollectableCreator(entry);

        if (exactKey && seenExact.has(exactKey)) {
            if (debugEnabled && dropped.length < MAX_DEBUG_ITEMS) {
                dropped.push(toDebugItem(entry, idx, { reason: 'duplicate_exact_key' }));
            }
            return;
        }
        if (identityKey && seenIdentity.has(identityKey)) {
            if (debugEnabled && dropped.length < MAX_DEBUG_ITEMS) {
                dropped.push(toDebugItem(entry, idx, { reason: 'duplicate_identity_key' }));
            }
            return;
        }
        if (kindTitleKey && creator) {
            const existingCreators = seenKindTitleCreators.get(kindTitleKey) || [];
            if (existingCreators.some((existing) => areCreatorStringsEquivalent(existing, creator))) {
                if (debugEnabled && dropped.length < MAX_DEBUG_ITEMS) {
                    dropped.push(toDebugItem(entry, idx, { reason: 'duplicate_kind_title_creator_equivalent' }));
                }
                return;
            }
        }

        if (exactKey) seenExact.add(exactKey);
        if (identityKey) seenIdentity.add(identityKey);
        rememberCreatorForKindTitle(entry);
        appended.push(entry);
    });

    if (debugEnabled) {
        logDebug(debugConfig.tag, 'appendProcessedItems', {
            query: normalizedQuery,
            previousCount: previous.length,
            incomingCount: incoming.length,
            incomingLocalCount: incomingLocal.length,
            incomingApiCount: incomingApi.length,
            incomingLocalPreferredCount: incomingLocalPreferred.length,
            incomingLocalWeakCount: incomingLocalWeak.length,
            appendedCount: appended.length,
            droppedCount: dropped.length,
            topPrevious: previous.slice(0, MAX_DEBUG_ITEMS).map((entry, index) => toDebugItem(entry, index)),
            topIncomingApiRanked: sortedIncomingApiWrapped.slice(0, MAX_DEBUG_ITEMS).map((wrapped, rank) => (
                toDebugItem(wrapped.entry, rank, {
                    tier: wrapped.tier,
                    originalApiIndex: wrapped.index,
                    qualityScore: wrapped.signals?.qualityScore ?? 0,
                    creatorMatch: wrapped.signals?.creatorMatch ?? false,
                })
            )),
            topDropped: dropped,
            topAppended: appended.slice(0, MAX_DEBUG_ITEMS).map((entry, index) => toDebugItem(entry, index)),
        });
    }

    return [...previous, ...appended];
}

export function buildCollectableItemKey(item, index = 0) {
    if (item?.id != null) return `id-${item.id}`;

    const provider = String(item?.source || item?.provider || 'api').trim().toLowerCase();
    const externalId = String(item?.externalId || item?.external_id || '').trim();
    if (externalId) return `${provider}-ext-${externalId}`;

    const kind = getNormalizedCollectableKind(item) || 'unknown-kind';
    const title = getNormalizedCollectableTitle(item) || 'untitled';
    const creator = getNormalizedCollectableCreator(item) || 'unknown-creator';
    return `${provider}-text-${kind}-${title}-${creator}-${index}`;
}

function normalizeContainerType(value) {
    const normalized = normalizeCollectableField(value);
    if (!normalized) return '';
    if (normalized === 'all') return '';
    if (normalized === 'book') return 'books';
    if (normalized === 'movie' || normalized === 'film') return 'movies';
    if (normalized === 'game') return 'games';
    if (normalized === 'album' || normalized === 'record') return 'vinyl';
    return normalized;
}

export function buildCollectableSearchQuery({ title = '', creator = '' } = {}) {
    const normalizedTitle = String(title || '').trim();
    const normalizedCreator = String(creator || '').trim();
    if (normalizedTitle && normalizedCreator) return `${normalizedTitle} by ${normalizedCreator}`;
    return normalizedTitle || normalizedCreator || '';
}

export function useCollectableSearchEngine({
    apiBase,
    token,
    pageLimit = DEFAULT_COLLECTABLE_SEARCH_LIMIT,
    defaultApiSupplement = false,
    defaultFallbackLimit = DEFAULT_API_FALLBACK_RESULTS_LIMIT,
    debugTag = '',
    debugQueryAllowlist = DEFAULT_DEBUG_QUERY_ALLOWLIST,
} = {}) {
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [searched, setSearched] = useState(false);
    const [pagination, setPagination] = useState({
        offset: 0,
        nextOffset: 0,
        limit: pageLimit,
        hasMore: false,
        total: 0,
    });

    const queryRef = useRef('');
    const typeRef = useRef('');
    const platformRef = useRef('');
    const searchOptionsRef = useRef({
        forceApiFallback: false,
        forceApiSupplement: Boolean(defaultApiSupplement),
        fallbackLimit: defaultFallbackLimit,
    });

    const buildPath = useCallback(({
        queryText,
        type = '',
        platform = '',
        offset = 0,
        forceApiFallback = false,
        forceApiSupplement = false,
        fallbackLimit = defaultFallbackLimit,
    }) => {
        const trimmedQuery = String(queryText || '').trim();
        const normalizedType = normalizeContainerType(type);
        const normalizedPlatform = String(platform || '').trim();
        const shouldUseFallbackApi = Boolean(forceApiFallback) || trimmedQuery.length >= MIN_FALLBACK_QUERY_LENGTH;
        const shouldSupplementWithApi = Boolean(forceApiSupplement);
        const resolvedFallbackLimit = Number.isFinite(Number(fallbackLimit))
            ? Math.max(1, Math.floor(Number(fallbackLimit)))
            : DEFAULT_API_FALLBACK_RESULTS_LIMIT;

        const encodedType = normalizedType ? `&type=${encodeURIComponent(normalizedType)}` : '';
        const encodedPlatform = normalizedPlatform ? `&platform=${encodeURIComponent(normalizedPlatform)}` : '';
        const fallbackParams = shouldUseFallbackApi
            ? `&fallbackApi=true&fallbackLimit=${resolvedFallbackLimit}${shouldSupplementWithApi ? '&apiSupplement=true' : ''}`
            : '&fallbackApi=false';
        const path = `/api/collectables?q=${encodeURIComponent(trimmedQuery)}&wildcard=true&limit=${pageLimit}&offset=${offset}${encodedType}${encodedPlatform}${fallbackParams}`;

        return {
            path,
            shouldUseFallbackApi,
            shouldSupplementWithApi,
            resolvedFallbackLimit,
            normalizedType,
            normalizedPlatform,
            trimmedQuery,
        };
    }, [defaultFallbackLimit, pageLimit]);

    const search = useCallback(async ({
        query,
        type = '',
        platform = '',
        forceApiFallback,
        forceApiSupplement,
        fallbackLimit,
    } = {}) => {
        const queryText = String(query || '').trim();
        if (!queryText) {
            setResults([]);
            setSearched(false);
            setPagination((prev) => ({
                offset: 0,
                nextOffset: 0,
                limit: prev.limit,
                hasMore: false,
                total: 0,
            }));
            queryRef.current = '';
            typeRef.current = normalizeContainerType(type);
            platformRef.current = String(platform || '').trim();
            return { results: [], requestPath: '', pagination: null };
        }

        const request = buildPath({
            queryText,
            type,
            platform,
            offset: 0,
            forceApiFallback: forceApiFallback ?? false,
            forceApiSupplement: forceApiSupplement ?? defaultApiSupplement,
            fallbackLimit,
        });

        searchOptionsRef.current = {
            forceApiFallback: request.shouldUseFallbackApi,
            forceApiSupplement: request.shouldSupplementWithApi,
            fallbackLimit: request.resolvedFallbackLimit,
        };

        queryRef.current = queryText;
        typeRef.current = request.normalizedType;
        platformRef.current = request.normalizedPlatform;

        try {
            setLoading(true);
            setSearched(true);
            const response = await apiRequest({ apiBase, path: request.path, token });
            const incoming = Array.isArray(response?.results) ? response.results : [];
            const processed = processIncomingItems([], incoming, queryText, {
                tag: debugTag,
                queryAllowlist: debugQueryAllowlist,
            });
            const responseOffset = Number.isFinite(Number(response?.pagination?.offset))
                ? Number(response.pagination.offset)
                : 0;
            const responseCount = Number.isFinite(Number(response?.pagination?.count))
                ? Number(response.pagination.count)
                : incoming.length;
            const computedNextOffset = responseOffset + Math.max(0, responseCount);

            setResults(processed);
            const nextPagination = {
                offset: responseOffset,
                nextOffset: computedNextOffset,
                limit: response?.pagination?.limit ?? pageLimit,
                hasMore: Boolean(response?.pagination?.hasMore),
                total: Number.isFinite(response?.pagination?.total) ? response.pagination.total : processed.length,
            };
            setPagination(nextPagination);

            if (shouldLogDebug(queryText, debugQueryAllowlist)) {
                logDebug(debugTag, 'initialSearchPage', {
                    query: normalizeCollectableField(queryText),
                    requestPath: request.path,
                    responsePagination: response?.pagination || null,
                    responseSources: response?.sources || null,
                    responseSearched: response?.searched || null,
                    incomingCount: incoming.length,
                    renderedCount: processed.length,
                    computedNextOffset,
                });
            }

            return {
                results: processed,
                pagination: nextPagination,
                requestPath: request.path,
                response,
            };
        } finally {
            setLoading(false);
        }
    }, [apiBase, buildPath, debugQueryAllowlist, debugTag, defaultApiSupplement, pageLimit, token]);

    const loadMore = useCallback(async () => {
        if (loading || loadingMore) return { results, pagination };
        if (!pagination.hasMore) return { results, pagination };
        const queryText = String(queryRef.current || '').trim();
        if (!queryText) return { results, pagination };

        const requestOffset = Number.isFinite(Number(pagination.nextOffset))
            ? Number(pagination.nextOffset)
            : 0;
        const request = buildPath({
            queryText,
            type: typeRef.current,
            platform: platformRef.current,
            offset: requestOffset,
            forceApiFallback: searchOptionsRef.current.forceApiFallback,
            forceApiSupplement: searchOptionsRef.current.forceApiSupplement,
            fallbackLimit: searchOptionsRef.current.fallbackLimit,
        });

        try {
            setLoadingMore(true);
            const response = await apiRequest({ apiBase, path: request.path, token });
            const incoming = Array.isArray(response?.results) ? response.results : [];

            if (shouldLogDebug(queryText, debugQueryAllowlist)) {
                logDebug(debugTag, 'loadMorePage', {
                    query: normalizeCollectableField(queryText),
                    requestOffset,
                    requestPath: request.path,
                    responsePagination: response?.pagination || null,
                    responseSources: response?.sources || null,
                    incomingCount: incoming.length,
                });
            }

            let nextResults = results;
            setResults((prev) => {
                nextResults = processIncomingItems(prev, incoming, queryText, {
                    tag: debugTag,
                    queryAllowlist: debugQueryAllowlist,
                });
                return nextResults;
            });

            let nextPagination = pagination;
            setPagination((prev) => {
                nextPagination = {
                    offset: Number.isFinite(Number(response?.pagination?.offset))
                        ? Number(response.pagination.offset)
                        : requestOffset,
                    nextOffset: (
                        (Number.isFinite(Number(response?.pagination?.offset))
                            ? Number(response.pagination.offset)
                            : requestOffset)
                        + Math.max(
                            0,
                            Number.isFinite(Number(response?.pagination?.count))
                                ? Number(response.pagination.count)
                                : incoming.length,
                        )
                    ),
                    limit: response?.pagination?.limit ?? prev.limit,
                    hasMore: Boolean(response?.pagination?.hasMore),
                    total: Number.isFinite(response?.pagination?.total) ? response.pagination.total : prev.total,
                };
                return nextPagination;
            });

            return {
                results: nextResults,
                pagination: nextPagination,
                requestPath: request.path,
                response,
            };
        } finally {
            setLoadingMore(false);
        }
    }, [apiBase, buildPath, debugQueryAllowlist, debugTag, loading, loadingMore, pagination, results, token]);

    const reset = useCallback(() => {
        queryRef.current = '';
        typeRef.current = '';
        platformRef.current = '';
        searchOptionsRef.current = {
            forceApiFallback: false,
            forceApiSupplement: Boolean(defaultApiSupplement),
            fallbackLimit: defaultFallbackLimit,
        };
        setResults([]);
        setLoading(false);
        setLoadingMore(false);
        setSearched(false);
        setPagination({
            offset: 0,
            nextOffset: 0,
            limit: pageLimit,
            hasMore: false,
            total: 0,
        });
    }, [defaultApiSupplement, defaultFallbackLimit, pageLimit]);

    return {
        results,
        loading,
        loadingMore,
        searched,
        pagination,
        search,
        loadMore,
        reset,
    };
}
