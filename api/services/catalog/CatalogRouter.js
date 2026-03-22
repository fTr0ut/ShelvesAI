/**
 * CatalogRouter - Config-driven API orchestration
 * 
 * Routes catalog lookups through prioritized API adapters based on apiContainers.json config.
 * Supports two modes:
 * - "fallback": Stop on first successful result (default)
 * - "merge": Call all enabled APIs and merge/dedupe results
 * 
 * Supports env var overrides to disable specific APIs without editing config:
 *   DISABLE_HARDCOVER=true, DISABLE_OPENLIBRARY=true, etc.
 */

const path = require('path');
const { getMetadataScorer } = require('./MetadataScorer');
const { getApiContainerKey } = require('../config/shelfTypeResolver');
const logger = require('../../logger');

// Load config - will be cached by require()
let containersConfig;
try {
    containersConfig = require('../../config/apiContainers.json');
} catch (err) {
    logger.warn('[CatalogRouter] Failed to load apiContainers.json, using empty config:', err.message);
    containersConfig = {};
}

function parseBoolean(value) {
    if (value === true || value === false) return value;
    if (value == null) return false;
    const normalized = String(value).trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

class CatalogRouter {
    constructor(options = {}) {
        this.config = options.config || containersConfig;
        this.adapters = {};
        this._adapterInstances = new Map();

        // Lazy-load adapters to avoid circular dependencies
        this._adapterFactories = {
            hardcover: () => this._loadAdapter('HardcoverAdapter'),
            openLibrary: () => this._loadAdapter('OpenLibraryAdapter'),
            igdb: () => this._loadAdapter('IgdbAdapter'),
            tmdb: () => this._loadAdapter('TmdbAdapter'),
            tmdbTv: () => this._loadAdapter('TmdbTvAdapter'),
            musicbrainz: () => this._loadAdapter('MusicBrainzAdapter'),
            discogs: () => this._loadAdapter('DiscogsAdapter'),
        };
    }

    wrapCollectableResult(result, meta = {}) {
        if (!result || typeof result !== 'object') {
            return result;
        }
        if (result.__collectable && result.collectable) {
            return { ...result, ...meta };
        }
        const collectable = { ...result };
        return {
            ...result,
            __collectable: true,
            collectable,
            ...meta,
        };
    }

    _loadAdapter(adapterName) {
        if (this._adapterInstances.has(adapterName)) {
            return this._adapterInstances.get(adapterName);
        }

        try {
            const adapterPath = path.join(__dirname, 'adapters', `${adapterName}.js`);
            const AdapterClass = require(adapterPath);
            const instance = new AdapterClass();
            this._adapterInstances.set(adapterName, instance);
            return instance;
        } catch (err) {
            logger.warn(`[CatalogRouter] Failed to load adapter ${adapterName}:`, err.message);
            return null;
        }
    }

    /**
     * Get the container config for a media type, resolving aliases
     * @param {string} containerType - e.g., "books", "games", "movies"
     * @returns {object|null} Container config or null
     */
    getContainer(containerType) {
        const normalized = normalizeString(containerType).toLowerCase();

        // Direct match
        if (this.config[normalized]) {
            return this.config[normalized];
        }

        // Use shelfTypeResolver for alias resolution
        const apiContainerKey = getApiContainerKey(containerType);
        if (apiContainerKey && this.config[apiContainerKey]) {
            return this.config[apiContainerKey];
        }

        return null;
    }

    /**
     * Get enabled APIs for a container, sorted by priority
     * Respects env var overrides
     * @param {string} containerType
     * @returns {Array} Sorted array of enabled API configs
     */
    getEnabledApis(containerType) {
        const container = this.getContainer(containerType);
        if (!container || !Array.isArray(container.apis)) {
            return [];
        }

        return container.apis
            .filter(api => {
                // Check if disabled via config
                if (!api.enabled) return false;

                // Check if disabled via env var
                if (api.envDisableKey && parseBoolean(process.env[api.envDisableKey])) {
                    return false;
                }

                return true;
            })
            .sort((a, b) => (a.priority || 999) - (b.priority || 999));
    }

    /**
     * Get the adapter instance for an API
     * @param {string} apiName
     * @returns {object|null} Adapter instance or null
     */
    getAdapter(apiName) {
        const factory = this._adapterFactories[apiName];
        if (!factory) {
            logger.warn(`[CatalogRouter] Unknown adapter: ${apiName}`);
            return null;
        }
        return factory();
    }

    /**
     * Main lookup method - routes through prioritized APIs
     * @param {object} item - Item to look up (title, author, identifiers, etc.)
     * @param {string} containerType - Media type container (books, games, movies)
     * @param {object} options - Additional options
     * @returns {Promise<object|null>} Lookup result or null
     */
    async lookup(item, containerType, options = {}) {
        const container = this.getContainer(containerType);
        if (!container) {
            logger.info('[CatalogRouter] No container found for type:', containerType);
            return null;
        }

        const apis = this.getEnabledApis(containerType);
        if (!apis.length) {
            logger.info('[CatalogRouter] No enabled APIs for container:', containerType);
            return null;
        }

        const mode = container.mode || 'fallback';
        const sharedOptions = {
            ...options,
            containerType,
            container,
        };
        logger.info(`[CatalogRouter] Looking up item in ${containerType} container (mode: ${mode}), APIs:`, apis.map(a => a.name));

        if (mode === 'merge') {
            return this._lookupMerge(item, apis, sharedOptions);
        }

        return this._lookupFallback(item, apis, sharedOptions);
    }

    /**
     * Fallback mode: Stop on first successful result
     */
    async _lookupFallback(item, apis, options = {}) {
        const containerType = options.containerType || '';
        const scorer = getMetadataScorer();
        const minScore = scorer.getMinScore(containerType);
        const shouldScore = minScore !== null;
        let bestCandidate = null;

        for (const api of apis) {
            const adapter = this.getAdapter(api.name);
            if (!adapter) continue;

            // Check if adapter is configured (has required credentials)
            if (typeof adapter.isConfigured === 'function' && !adapter.isConfigured()) {
                logger.info(`[CatalogRouter] Skipping ${api.name} - not configured`);
                continue;
            }

            try {
                logger.info(`[CatalogRouter] Trying ${api.name}...`);
                const result = await adapter.lookup(item, options);

                if (result) {
                    if (!shouldScore || !Number.isFinite(minScore)) {
                        logger.info(`[CatalogRouter] Hit on ${api.name}`);
                        return this.wrapCollectableResult(result, {
                            _source: api.name,
                            _sourceIndex: apis.indexOf(api),
                        });
                    }

                    const metadata = await scorer.scoreAsync(result, containerType);
                    const sourceIndex = apis.indexOf(api);
                    if (!bestCandidate || metadata.score > bestCandidate.metadata.score) {
                        bestCandidate = {
                            result,
                            metadata,
                            source: api.name,
                            sourceIndex,
                        };
                    }

                    if (metadata.score >= minScore) {
                        logger.info(`[CatalogRouter] Hit on ${api.name}`);
                        return this.wrapCollectableResult(result, {
                            _source: api.name,
                            _sourceIndex: sourceIndex,
                            _metadataScore: metadata.score,
                            _metadataMissing: metadata.missing,
                        });
                    }

                    logger.info(`[CatalogRouter] Low metadata score from ${api.name}, trying next API`, {
                        score: metadata.score,
                        missing: metadata.missing,
                    });
                    continue;
                }

                logger.info(`[CatalogRouter] No result from ${api.name}`);
            } catch (err) {
                logger.warn(`[CatalogRouter] ${api.name} failed:`, err.message);
                // Continue to next API
            }
        }

        if (bestCandidate) {
            logger.info('[CatalogRouter] Returning best available result below metadata threshold', {
                source: bestCandidate.source,
                score: bestCandidate.metadata.score,
            });
            return this.wrapCollectableResult(bestCandidate.result, {
                _source: bestCandidate.source,
                _sourceIndex: bestCandidate.sourceIndex,
                _metadataScore: bestCandidate.metadata.score,
                _metadataMissing: bestCandidate.metadata.missing,
            });
        }

        logger.info('[CatalogRouter] All APIs exhausted, no result found');
        return null;
    }
    /**
     * Merge mode: Call all enabled APIs and merge results
     */
    async _lookupMerge(item, apis, options = {}) {
        const results = [];

        // Call all APIs in parallel
        const promises = apis.map(async (api) => {
            const adapter = this.getAdapter(api.name);
            if (!adapter) return null;

            if (typeof adapter.isConfigured === 'function' && !adapter.isConfigured()) {
                return null;
            }

            try {
                logger.info(`[CatalogRouter] (merge) Calling ${api.name}...`);
                const result = await adapter.lookup(item, options);
                if (result) {
                    return {
                        ...result,
                        _source: api.name,
                        _sourcePriority: api.priority,
                    };
                }
                return null;
            } catch (err) {
                logger.warn(`[CatalogRouter] (merge) ${api.name} failed:`, err.message);
                return null;
            }
        });

        const allResults = await Promise.all(promises);
        const validResults = allResults.filter(Boolean);

        if (!validResults.length) {
            return null;
        }

        // Sort by source priority and return merged result
        validResults.sort((a, b) => (a._sourcePriority || 999) - (b._sourcePriority || 999));

        // Merge: prefer higher-priority source, fill in gaps from lower priority
        const merged = this._mergeResults(validResults);
        merged._sources = validResults.map(r => r._source);

        logger.info(`[CatalogRouter] (merge) Combined results from:`, merged._sources);
        return this.wrapCollectableResult(merged);
    }

    /**
     * Merge multiple results, preferring earlier (higher priority) sources
     */
    _mergeResults(results) {
        if (!results.length) return null;
        if (results.length === 1) return results[0];

        const merged = { ...results[0] };

        // Fields that can be filled in from lower-priority sources
        const fillableFields = [
            'description', 'coverUrl', 'year', 'publishers', 'tags', 'identifiers',
        ];

        for (let i = 1; i < results.length; i++) {
            const source = results[i];

            for (const field of fillableFields) {
                // Fill in missing fields
                if (!merged[field] && source[field]) {
                    merged[field] = source[field];
                }

                // Merge arrays
                if (Array.isArray(merged[field]) && Array.isArray(source[field])) {
                    const existing = new Set(merged[field].map(v => JSON.stringify(v)));
                    for (const item of source[field]) {
                        if (!existing.has(JSON.stringify(item))) {
                            merged[field].push(item);
                        }
                    }
                }

                // Merge identifier objects
                if (field === 'identifiers' && typeof merged[field] === 'object' && typeof source[field] === 'object') {
                    for (const key in source[field]) {
                        if (!merged[field][key]) {
                            merged[field][key] = source[field][key];
                        }
                    }
                }
            }
        }

        return merged;
    }

    /**
     * Check if a container type is supported
     */
    supportsContainerType(containerType) {
        return this.getContainer(containerType) !== null;
    }

    /**
     * Reload config (useful for testing or hot-reload)
     */
    reloadConfig() {
        delete require.cache[require.resolve('../../config/apiContainers.json')];
        try {
            this.config = require('../../config/apiContainers.json');
            logger.info('[CatalogRouter] Config reloaded');
        } catch (err) {
            logger.warn('[CatalogRouter] Failed to reload config:', err.message);
        }
    }
}

// Singleton instance
let instance = null;

function getCatalogRouter() {
    if (!instance) {
        instance = new CatalogRouter();
    }
    return instance;
}

module.exports = { CatalogRouter, getCatalogRouter };

