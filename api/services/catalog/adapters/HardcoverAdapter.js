/**
 * HardcoverAdapter - Adapter for Hardcover.app API
 * 
 * Wraps the existing HardcoverClient to implement the standard CatalogAdapter interface.
 */

const { HardcoverClient } = require('../../hardcover');
const { hardcoverToCollectable } = require('../../../adapters/hardcover.adapter');
const { makeLightweightFingerprint } = require('../../collectables/fingerprint');

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

class HardcoverAdapter {
    constructor(options = {}) {
        this.client = new HardcoverClient({
            token: options.token,
            baseUrl: options.baseUrl,
            timeoutMs: options.timeoutMs,
            requestsPerMinute: options.requestsPerMinute,
            userAgent: options.userAgent,
        });
        this.name = 'hardcover';
    }

    /**
     * Check if the adapter is configured (has required credentials)
     */
    isConfigured() {
        return this.client.isConfigured();
    }

    /**
     * Main lookup method - tries ISBN first, then title/author
     * @param {object} item - Item with title, author, identifiers, etc.
     * @param {object} options - Additional options
     * @returns {Promise<object|null>} Collectable-shaped result or null
     */
    async lookup(item, options = {}) {
        if (!this.isConfigured()) {
            return null;
        }

        const title = normalizeString(item?.name || item?.title);
        const author = normalizeString(item?.author || item?.primaryCreator);
        const identifiers = item?.identifiers || {};

        // Collect ISBN candidates
        const isbnCandidates = [
            ...(Array.isArray(identifiers.isbn13) ? identifiers.isbn13 : []),
            ...(Array.isArray(identifiers.isbn10) ? identifiers.isbn10 : []),
        ]
            .map(code => normalizeString(code))
            .filter(Boolean);

        // Try ISBN lookup first (fastest path to authoritative data)
        for (const isbn of isbnCandidates) {
            try {
                const result = await this.client.lookupByISBN(isbn);
                if (result) {
                    return this._toCollectable(result, item);
                }
            } catch (err) {
                console.warn(`[HardcoverAdapter] ISBN lookup failed for ${isbn}:`, err.message);
                // Continue to next ISBN
            }
        }

        // Fall back to title/author search
        if (title || author) {
            try {
                const result = await this.client.lookupByTitleAuthor({
                    title,
                    author,
                    limit: 5,
                });
                if (result) {
                    return this._toCollectable(result, item);
                }
            } catch (err) {
                console.warn('[HardcoverAdapter] Title/author lookup failed:', err.message);
            }
        }

        return null;
    }

    /**
     * ISBN-specific lookup
     */
    async lookupByIsbn(isbn) {
        if (!this.isConfigured()) return null;

        try {
            const result = await this.client.lookupByISBN(isbn);
            if (result) {
                return this._toCollectable(result, { identifiers: { isbn13: [isbn] } });
            }
        } catch (err) {
            console.warn('[HardcoverAdapter] lookupByIsbn failed:', err.message);
        }
        return null;
    }

    /**
     * Title/author specific lookup
     */
    async lookupByTitleAuthor(title, author) {
        if (!this.isConfigured()) return null;

        try {
            const result = await this.client.lookupByTitleAuthor({ title, author });
            if (result) {
                return this._toCollectable(result, { title, author });
            }
        } catch (err) {
            console.warn('[HardcoverAdapter] lookupByTitleAuthor failed:', err.message);
        }
        return null;
    }

    /**
     * Convert Hardcover API response to standard collectable format
     */
    _toCollectable(result, originalItem) {
        const lwf = makeLightweightFingerprint(originalItem);

        // Use the existing hardcoverToCollectable adapter
        const collectable = hardcoverToCollectable(result, {
            lightweightFingerprint: lwf,
        });

        if (collectable) {
            collectable.provider = 'hardcover';
            collectable._raw = result;
        }

        return collectable;
    }
}

module.exports = HardcoverAdapter;
