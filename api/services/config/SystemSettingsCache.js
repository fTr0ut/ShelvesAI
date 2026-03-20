'use strict';

/**
 * SystemSettingsCache
 *
 * In-memory cache with TTL for system settings. Avoids hitting the DB on every
 * MetadataScorer.scoreAsync() call. The cache is keyed by setting key and stores
 * the `value` field from the DB row.
 *
 * The `queryFn` option allows test injection to avoid real DB calls.
 */
class SystemSettingsCache {
    /**
     * @param {object} [options]
     * @param {number} [options.ttlMs=60000] - Cache TTL in milliseconds (default 1 minute)
     * @param {Function} [options.queryFn] - Injected query function for testing
     */
    constructor(options = {}) {
        this._cache = new Map(); // key → { value, expiresAt }
        this._ttlMs = options.ttlMs ?? 60000;
        this._queryFn = options.queryFn ?? null;
    }

    /**
     * Get the value for a setting key. Returns the `value` field from the DB row,
     * or null if not found. Uses in-memory cache with TTL.
     *
     * @param {string} key
     * @returns {Promise<any|null>}
     */
    async get(key) {
        const cached = this._cache.get(key);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.value;
        }

        // Cache miss or expired — fetch from DB
        const getFn = this._queryFn || require('../../database/queries/systemSettings').getSetting;
        const row = await getFn(key);
        const value = row?.value ?? null;
        this._cache.set(key, { value, expiresAt: Date.now() + this._ttlMs });
        return value;
    }

    /**
     * Invalidate a specific key or the entire cache.
     * @param {string} [key] - If omitted, clears the entire cache
     */
    invalidate(key) {
        if (key) {
            this._cache.delete(key);
        } else {
            this._cache.clear();
        }
    }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance = null;

function getSystemSettingsCache() {
    if (!_instance) {
        _instance = new SystemSettingsCache();
    }
    return _instance;
}

module.exports = { SystemSettingsCache, getSystemSettingsCache };
