/**
 * TmdbAdapter - Adapter for The Movie Database (TMDB) API
 * 
 * Wraps the MovieCatalogService methods to implement the standard CatalogAdapter interface.
 */

const { makeLightweightFingerprint } = require('../../collectables/fingerprint');
const { tmdbMovieToCollectable } = require('../../../adapters/tmdb.adapter');

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

function extractYear(value) {
    if (!value) return null;
    const match = String(value).match(/\b(\d{4})\b/);
    return match ? Number.parseInt(match[1], 10) : null;
}

class TmdbAdapter {
    constructor(options = {}) {
        this.name = 'tmdb';
        this._service = null;
        this._serviceOptions = options;
    }

    /**
     * Lazy-load the MovieCatalogService to avoid circular dependencies
     */
    _getService() {
        if (!this._service) {
            const { MovieCatalogService } = require('../MovieCatalogService');
            this._service = new MovieCatalogService(this._serviceOptions);
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

            if (result && result.movie) {
                return this._toCollectable(result, item);
            }
        } catch (err) {
            console.warn('[TmdbAdapter] lookup failed:', err.message);
        }

        return null;
    }

    /**
     * Convert TMDB API response to standard collectable format
     */
    _toCollectable(result, originalItem) {
        const service = this._getService();
        const lwf = makeLightweightFingerprint({
            ...originalItem,
            kind: originalItem?.kind || originalItem?.type || 'movie',
        });

        const collectable = tmdbMovieToCollectable(result.movie, {
            lightweightFingerprint: lwf,
            baseUrl: service.baseUrl,
            imageBaseUrl: service.imageBaseUrl,
            score: result.score,
            format: normalizeString(originalItem?.format),
        });

        if (collectable) {
            collectable.provider = 'tmdb';
            collectable._raw = result;

            if (!collectable.lightweightFingerprint) {
                collectable.lightweightFingerprint = lwf;
            }
        }

        return collectable;
    }
}

module.exports = TmdbAdapter;
