/**
 * TmdbTvAdapter - Adapter for TMDB TV Shows API
 * 
 * Wraps the TvCatalogService methods to implement the standard CatalogAdapter interface.
 */

const { makeLightweightFingerprint } = require('../../collectables/fingerprint');
const { tmdbTvToCollectable } = require('../../../adapters/tmdbTv.adapter');

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

class TmdbTvAdapter {
    constructor(options = {}) {
        this.name = 'tmdbTv';
        this._service = null;
        this._serviceOptions = options;
    }

    /**
     * Lazy-load the TvCatalogService to avoid circular dependencies
     */
    _getService() {
        if (!this._service) {
            const { TvCatalogService } = require('../TvCatalogService');
            this._service = new TvCatalogService(this._serviceOptions);
        }
        return this._service;
    }

    /**
     * Check if the adapter is configured (has required credentials)
     */
    isConfigured() {
        const apiKey = process.env.TMDB_API_KEY;
        return !!apiKey;
    }

    /**
     * Main lookup method
     * @param {object} item - Item with title, year, identifiers, etc.
     * @param {object} options - Additional options
     * @returns {Promise<object|null>} Collectable-shaped result or null
     */
    async lookup(item, options = {}) {
        if (!this.isConfigured()) {
            return null;
        }

        const service = this._getService();
        const title = normalizeString(item?.name || item?.title);

        if (!title) {
            return null;
        }

        try {
            const result = await service.safeLookup(item, options.retries || 2);

            if (result && result.tv) {
                return this._toCollectable(result, item);
            }
        } catch (err) {
            console.warn('[TmdbTvAdapter] lookup failed:', err.message);
        }

        return null;
    }

    /**
     * Convert TMDB TV API response to standard collectable format
     */
    _toCollectable(result, originalItem) {
        const service = this._getService();
        const lwf = makeLightweightFingerprint({
            ...originalItem,
            kind: originalItem?.kind || originalItem?.type || 'tv',
        });

        const collectable = tmdbTvToCollectable(result.tv, {
            lightweightFingerprint: lwf,
            baseUrl: service.baseUrl,
            imageBaseUrl: service.imageBaseUrl,
            score: result.score,
            format: normalizeString(originalItem?.format),
        });

        if (collectable) {
            collectable.provider = 'tmdbTv';
            collectable._raw = result;

            if (!collectable.lightweightFingerprint) {
                collectable.lightweightFingerprint = lwf;
            }
        }

        return collectable;
    }
}

module.exports = TmdbTvAdapter;
