/**
 * OpenLibraryAdapter - Adapter for Open Library API
 * 
 * Wraps the existing openLibrary module to implement the standard CatalogAdapter interface.
 */

const {
    lookupWorkBookMetadata,
    lookupWorkByISBN,
    toCollectionDoc
} = require('../../openLibrary');
const { openLibraryToCollectable } = require('../../../adapters/openlibrary.adapter');
const { makeLightweightFingerprint } = require('../../collectables/fingerprint');

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

class OpenLibraryAdapter {
    constructor(options = {}) {
        this.name = 'openLibrary';
        // OpenLibrary doesn't require authentication
    }

    /**
     * OpenLibrary is always configured (no auth required)
     */
    isConfigured() {
        return true;
    }

    /**
     * Main lookup method - tries ISBN first, then title/author
     * @param {object} item - Item with title, author, identifiers, etc.
     * @param {object} options - Additional options
     * @returns {Promise<object|null>} Collectable-shaped result or null
     */
    async lookup(item, options = {}) {
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

        // Try ISBN lookup first
        for (const isbn of isbnCandidates) {
            try {
                const result = await lookupWorkByISBN(isbn);
                if (result) {
                    return this._normalizeResult(result, item);
                }
            } catch (err) {
                // Check for 404 (not found) vs other errors
                if (!String(err?.message).includes('404')) {
                    console.warn(`[OpenLibraryAdapter] ISBN lookup failed for ${isbn}:`, err.message);
                }
                // Continue to next ISBN
            }
        }

        // Fall back to title/author search
        if (title || author) {
            try {
                const result = await lookupWorkBookMetadata({ title, author });
                if (result) {
                    return this._normalizeResult(result, item);
                }
            } catch (err) {
                console.warn('[OpenLibraryAdapter] Title/author lookup failed:', err.message);
            }
        }

        return null;
    }

    /**
     * ISBN-specific lookup
     */
    async lookupByIsbn(isbn) {
        try {
            const result = await lookupWorkByISBN(isbn);
            if (result) {
                return this._normalizeResult(result, { identifiers: { isbn13: [isbn] } });
            }
        } catch (err) {
            if (!String(err?.message).includes('404')) {
                console.warn('[OpenLibraryAdapter] lookupByIsbn failed:', err.message);
            }
        }
        return null;
    }

    /**
     * Title/author specific lookup
     */
    async lookupByTitleAuthor(title, author) {
        try {
            const result = await lookupWorkBookMetadata({ title, author });
            if (result) {
                return this._normalizeResult(result, { title, author });
            }
        } catch (err) {
            console.warn('[OpenLibraryAdapter] lookupByTitleAuthor failed:', err.message);
        }
        return null;
    }

    /**
     * Normalize OpenLibrary result to standard collectable format
     */
    _normalizeResult(result, originalItem) {
        const lwf = makeLightweightFingerprint({
            ...originalItem,
            kind: originalItem?.kind || originalItem?.type || 'book',
        });

        // Use existing adapter if result is already in collectable format
        if (result.__collectable || result.kind === 'book') {
            result.provider = 'openlibrary';
            result.lightweightFingerprint = result.lightweightFingerprint || lwf;
            return result;
        }

        // Use the openlibrary adapter to convert
        const collectable = openLibraryToCollectable({
            ...result,
            lightweightFingerprint: lwf,
        });

        if (collectable) {
            collectable.provider = 'openlibrary';
            collectable._raw = result;
        }

        return collectable;
    }
}

module.exports = OpenLibraryAdapter;
