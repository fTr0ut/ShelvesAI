/**
 * CollectableMatchingService
 * 
 * Centralized service for finding existing collectables via multiple matching strategies:
 * 1. Lightweight fingerprint (exact hash match)
 * 2. Fuzzy fingerprint (previously stored OCR hashes)
 * 3. Title/creator fuzzy match (pg_trgm similarity)
 * 4. Catalog API lookup (external APIs as fallback)
 */

const collectablesQueries = require('../database/queries/collectables');
const { makeLightweightFingerprint } = require('./collectables/fingerprint');
const { BookCatalogService } = require('./catalog/BookCatalogService');
const { GameCatalogService } = require('./catalog/GameCatalogService');
const { MovieCatalogService } = require('./catalog/MovieCatalogService');

// Configurable fuzzy match threshold (0.0 - 1.0)
// Higher = stricter matching, fewer false positives
const DEFAULT_FUZZY_THRESHOLD = 0.5;
const FUZZY_MATCH_THRESHOLD = (() => {
    const raw = parseFloat(process.env.MANUAL_SEARCH_FUZZY_THRESHOLD || '');
    if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
    return DEFAULT_FUZZY_THRESHOLD;
})();

class CollectableMatchingService {
    constructor() {
        this.bookCatalogService = new BookCatalogService();
        this.gameCatalogService = new GameCatalogService();
        this.movieCatalogService = new MovieCatalogService();
        this.catalogServices = [
            this.gameCatalogService,
            this.movieCatalogService,
            this.bookCatalogService,
        ];
    }

    /**
     * Resolve the appropriate catalog service for a shelf type
     * @param {string} shelfType - 'book', 'movie', 'game', etc.
     * @returns {Object|null} Catalog service instance
     */
    resolveCatalogService(shelfType) {
        for (const service of this.catalogServices) {
            try {
                if (service.supportsShelfType(shelfType)) {
                    return service;
                }
            } catch (err) {
                console.error('[CollectableMatchingService] supportsShelfType failed', err?.message);
            }
        }
        return null;
    }

    /**
     * Search for existing collectables in the database
     * Returns all potential matches for user to choose from
     * 
     * @param {Object} itemData - { title, primaryCreator, author, name, type }
     * @param {string} shelfType - 'book', 'movie', 'game', etc.
     * @returns {Promise<Array>} Array of matches with source info
     */
    async searchDatabase(itemData, shelfType) {
        const suggestions = [];
        const title = itemData.title || itemData.name;
        const creator = itemData.primaryCreator || itemData.author;

        if (!title) {
            return suggestions;
        }

        console.log('[CollectableMatchingService] Searching database for:', { title, creator, shelfType });

        // 1. Check lightweight fingerprint (exact match)
        const lwf = makeLightweightFingerprint({ title, primaryCreator: creator });
        const fingerprintMatch = await collectablesQueries.findByLightweightFingerprint(lwf);
        if (fingerprintMatch) {
            console.log('[CollectableMatchingService] Fingerprint match:', fingerprintMatch.id, fingerprintMatch.title);
            suggestions.push({
                ...fingerprintMatch,
                matchSource: 'fingerprint',
                matchScore: 1.0,
            });
        }

        // 2. Check fuzzy fingerprint (OCR stored hashes)
        const fuzzyFpMatch = await collectablesQueries.findByFuzzyFingerprint(lwf);
        if (fuzzyFpMatch && !suggestions.some(s => s.id === fuzzyFpMatch.id)) {
            console.log('[CollectableMatchingService] Fuzzy fingerprint match:', fuzzyFpMatch.id, fuzzyFpMatch.title);
            suggestions.push({
                ...fuzzyFpMatch,
                matchSource: 'fuzzy_fingerprint',
                matchScore: 0.95,
            });
        }

        // 3. Fuzzy title/creator match (pg_trgm) - threshold configurable via MANUAL_SEARCH_FUZZY_THRESHOLD
        if (collectablesQueries.fuzzyMatch) {
            const fuzzyMatch = await collectablesQueries.fuzzyMatch(title, creator, shelfType, FUZZY_MATCH_THRESHOLD);
            if (fuzzyMatch && !suggestions.some(s => s.id === fuzzyMatch.id)) {
                console.log('[CollectableMatchingService] Fuzzy match:', fuzzyMatch.id, fuzzyMatch.title, 'score:', fuzzyMatch.combinedSim);
                // Only include if title is valid
                if (fuzzyMatch.title) {
                    suggestions.push({
                        ...fuzzyMatch,
                        matchSource: 'fuzzy_match',
                        matchScore: fuzzyMatch.combinedSim || 0.8,
                    });
                } else {
                    console.warn('[CollectableMatchingService] Fuzzy match has no title, skipping:', fuzzyMatch.id);
                }
            }
        }

        console.log('[CollectableMatchingService] Database search found', suggestions.length, 'suggestions');
        return suggestions;
    }

    /**
     * Search catalog APIs for matches
     * 
     * @param {Object} itemData - { title, primaryCreator, author, name }
     * @param {string} shelfType - 'book', 'movie', 'game', etc.
     * @returns {Promise<Object|null>} API result or null
     */
    async searchCatalogAPI(itemData, shelfType) {
        const catalogService = this.resolveCatalogService(shelfType);
        if (!catalogService) {
            console.log('[CollectableMatchingService] No catalog service for type:', shelfType);
            return null;
        }

        try {
            console.log('[CollectableMatchingService] Calling API for:', shelfType);
            const result = await catalogService.safeLookup({
                title: itemData.title || itemData.name,
                name: itemData.name || itemData.title,
                author: itemData.author || itemData.primaryCreator,
                primaryCreator: itemData.primaryCreator || itemData.author,
                identifiers: itemData.identifiers || {},
            });

            if (result) {
                console.log('[CollectableMatchingService] API result:', {
                    title: result.title,
                    primaryCreator: result.primaryCreator,
                    id: result.id
                });

                // Validate the API result has required fields
                if (!result.title) {
                    console.warn('[CollectableMatchingService] API result missing title, skipping');
                    return null;
                }

                return {
                    ...result,
                    matchSource: 'api',
                    fromApi: true,
                };
            } else {
                console.log('[CollectableMatchingService] API returned no result');
            }
        } catch (err) {
            console.error('[CollectableMatchingService] API lookup failed:', err?.message);
        }

        return null;
    }

    /**
     * Full search: database first, then API if no results
     * Returns suggestions for user to choose from
     * 
     * @param {Object} itemData - { title, primaryCreator, author, name, type }
     * @param {string} shelfType - 'book', 'movie', 'game', etc.
     * @param {Object} options - { includeApi: true }
     * @returns {Promise<{ suggestions: Array, searched: { database: boolean, api: boolean } }>}
     */
    async search(itemData, shelfType, options = {}) {
        const { includeApi = true } = options;
        const searched = { database: false, api: false };

        // Search database first
        searched.database = true;
        const dbSuggestions = await this.searchDatabase(itemData, shelfType);

        if (dbSuggestions.length > 0) {
            return {
                suggestions: dbSuggestions,
                searched,
            };
        }

        // If no DB results and API search enabled, try API
        if (includeApi) {
            searched.api = true;
            const apiResult = await this.searchCatalogAPI(itemData, shelfType);
            if (apiResult) {
                return {
                    suggestions: [apiResult],
                    searched,
                };
            }
        }

        return {
            suggestions: [],
            searched,
        };
    }

    /**
     * Find best existing collectable (for automatic matching in needs_review flow)
     * Tries fingerprint → fuzzy → API in order, returns first match
     * 
     * @param {Object} itemData - { title, primaryCreator, author, name }
     * @param {string} shelfType - 'book', 'movie', 'game', etc.
     * @returns {Promise<{ match: Object|null, source: string|null }>}
     */
    async findBestMatch(itemData, shelfType) {
        const title = itemData.title || itemData.name;
        const creator = itemData.primaryCreator || itemData.author;

        if (!title) {
            return { match: null, source: null };
        }

        // 1. Lightweight fingerprint
        const lwf = makeLightweightFingerprint({ title, primaryCreator: creator });
        let match = await collectablesQueries.findByLightweightFingerprint(lwf);
        if (match) {
            return { match, source: 'fingerprint' };
        }

        // 2. Fuzzy fingerprint
        match = await collectablesQueries.findByFuzzyFingerprint(lwf);
        if (match) {
            return { match, source: 'fuzzy_fingerprint' };
        }

        // 3. Fuzzy match
        if (collectablesQueries.fuzzyMatch) {
            match = await collectablesQueries.fuzzyMatch(title, creator, shelfType);
            if (match) {
                return { match, source: 'fuzzy_match' };
            }
        }

        // 4. Catalog API
        const apiResult = await this.searchCatalogAPI(itemData, shelfType);
        if (apiResult) {
            return { match: apiResult, source: 'api' };
        }

        return { match: null, source: null };
    }
}

// Singleton instance
let instance = null;

function getCollectableMatchingService() {
    if (!instance) {
        instance = new CollectableMatchingService();
    }
    return instance;
}

module.exports = {
    CollectableMatchingService,
    getCollectableMatchingService,
};
