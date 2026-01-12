/**
 * IgdbAdapter - Adapter for IGDB (Internet Game Database) API
 * 
 * Wraps the GameCatalogService IGDB methods to implement the standard CatalogAdapter interface.
 */

const { makeLightweightFingerprint } = require('../../collectables/fingerprint');

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

class IgdbAdapter {
    constructor(options = {}) {
        this.name = 'igdb';
        this._service = null;
        this._serviceOptions = options;
    }

    /**
     * Lazy-load the GameCatalogService to avoid circular dependencies
     */
    _getService() {
        if (!this._service) {
            const { GameCatalogService } = require('../GameCatalogService');
            this._service = new GameCatalogService(this._serviceOptions);
        }
        return this._service;
    }

    /**
     * Check if the adapter is configured (has required credentials)
     */
    isConfigured() {
        const clientId = process.env.IGDB_CLIENT_ID;
        const clientSecret = process.env.IGDB_CLIENT_SECRET;
        return !!(clientId && clientSecret);
    }

    /**
     * Main lookup method
     * @param {object} item - Item with title, platform, identifiers, etc.
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

            if (result && result.game) {
                return this._toCollectable(result, item);
            }
        } catch (err) {
            console.warn('[IgdbAdapter] lookup failed:', err.message);
        }

        return null;
    }

    /**
     * Convert IGDB API response to standard collectable format
     */
    _toCollectable(result, originalItem) {
        const service = this._getService();
        const lwf = makeLightweightFingerprint(originalItem);

        const collectable = service.mapIgdbGameToCollectable(
            result.game,
            originalItem,
            lwf,
            result.score
        );

        if (collectable) {
            collectable.provider = 'igdb';
            collectable._raw = result;
        }

        return collectable;
    }
}

module.exports = IgdbAdapter;
