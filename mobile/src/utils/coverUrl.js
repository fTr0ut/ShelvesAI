/**
 * Cover URL resolution utilities
 *
 * Extracted from SocialFeedScreen.js to eliminate DUP-4.
 * Logic must exactly match the original implementations.
 */

/**
 * Build a full media URI from a path or URL.
 * - Absolute http(s) URLs are returned as-is.
 * - Relative paths are prefixed with `<apiBase>/media/`.
 *
 * @param {string|null} value - Path or URL
 * @param {string} [apiBase=''] - API base URL
 * @returns {string|null}
 */
export function buildMediaUri(value, apiBase = '') {
    if (!value) return null;
    if (/^https?:/i.test(value)) return value;
    const normalized = String(value).replace(/\\/g, '/');
    const trimmed = normalized.replace(/^\/+/, '');
    const resource = trimmed.startsWith('media/') ? trimmed : `media/${trimmed}`;
    if (!apiBase) return `/${resource}`;
    return `${apiBase.replace(/\/+$/, '')}/${resource}`;
}

/**
 * Resolve the cover URL for a collectable item.
 *
 * Priority order:
 *  1. `coverMediaUrl`  — pre-resolved by API (S3/CloudFront)
 *  2. `coverMediaPath` — local media path (cached, preferred when available)
 *  3. `coverImageUrl`  — external or local path
 *  4. `coverUrl`       — legacy field
 *  5. `images[]`       — image array (urlLarge > urlMedium > urlSmall > url)
 *
 * @param {Object|null} collectable - Collectable/item object
 * @param {string} [apiBase=''] - API base URL for path construction
 * @returns {string|null}
 */
export function resolveCollectableCoverUrl(collectable, apiBase = '') {
    if (!collectable) return null;

    // Prefer pre-resolved URL from API (handles S3/CloudFront)
    if (collectable.coverMediaUrl) {
        return collectable.coverMediaUrl;
    }

    if (collectable.coverMediaPath) {
        return buildMediaUri(collectable.coverMediaPath, apiBase);
    }

    const coverImageUrl = collectable.coverImageUrl;
    if (coverImageUrl) {
        if (/^https?:/i.test(coverImageUrl)) {
            return coverImageUrl;
        }
        // Treat any non-absolute coverImageUrl as a local media path.
        // Some records may have stale/missing coverImageSource metadata.
        return buildMediaUri(coverImageUrl, apiBase);
    }

    if (collectable.coverUrl) {
        return /^https?:/i.test(collectable.coverUrl)
            ? collectable.coverUrl
            : buildMediaUri(collectable.coverUrl, apiBase);
    }

    const images = Array.isArray(collectable.images) ? collectable.images : [];
    for (const image of images) {
        const url = image?.urlLarge || image?.urlMedium || image?.urlSmall || image?.url;
        if (url) {
            return /^https?:/i.test(url) ? url : buildMediaUri(url, apiBase);
        }
    }

    return null;
}

/**
 * Resolve the cover URL for a manual item.
 *
 * Priority order:
 *  1. `coverMediaUrl`  — pre-resolved by API (S3/CloudFront)
 *  2. `coverMediaPath` — local media path
 *
 * @param {Object|null} manual - Manual item object
 * @param {string} [apiBase=''] - API base URL for path construction
 * @returns {string|null}
 */
export function resolveManualCoverUrl(manual, apiBase = '') {
    if (!manual) return null;

    // Prefer pre-resolved URL from API (handles S3/CloudFront)
    if (manual.coverMediaUrl) {
        return manual.coverMediaUrl;
    }

    if (manual.coverMediaPath) {
        return buildMediaUri(manual.coverMediaPath, apiBase);
    }

    return null;
}
