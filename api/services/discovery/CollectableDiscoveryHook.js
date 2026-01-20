/**
 * CollectableDiscoveryHook
 * 
 * Source-agnostic hook that processes enriched news discovery items
 * and upserts them to the collectables table with fingerprint-based deduplication.
 * 
 * Supports: Bluray, IGDB, TMDB, and future news sources.
 */

const collectablesQueries = require('../../database/queries/collectables');
const {
    makeCollectableFingerprint,
    makeLightweightFingerprint
} = require('../collectables/fingerprint');

// Environment toggle for gradual rollout
const HOOK_ENABLED = process.env.COLLECTABLE_DISCOVERY_HOOK_ENABLED !== 'false';

class CollectableDiscoveryHook {
    constructor(options = {}) {
        this.enabled = options.enabled ?? HOOK_ENABLED;
        this.imageBaseUrl = options.imageBaseUrl || 'https://image.tmdb.org/t/p/w500';
    }

    /**
     * Process any enriched news item into a collectable
     * @param {Object} options
     * @param {string} options.source - 'bluray', 'igdb', 'tmdb', etc.
     * @param {string} options.kind - 'movie', 'game', 'book', etc.
     * @param {Object} options.enrichment - API-specific enrichment data (e.g., TMDB result)
     * @param {Object} options.originalItem - Raw scraped/fetched item from discovery adapter
     * @returns {Promise<{ status: string, collectable?: Object, reason?: string }>}
     */
    async processEnrichedItem({ source, kind, enrichment, originalItem }) {
        if (!this.enabled) {
            return { status: 'disabled' };
        }

        // 1. Build collectable payload using source-specific adapter
        const payload = this.buildPayload({ source, kind, enrichment, originalItem });
        if (!payload?.title) {
            console.log(`[CollectableDiscoveryHook] Skipping item - no title:`, originalItem?.title);
            return { status: 'skipped', reason: 'no_title' };
        }

        // 2. Generate fingerprints for deduplication
        const fingerprint = makeCollectableFingerprint({
            title: payload.title,
            primaryCreator: payload.primaryCreator,
            releaseYear: payload.year,
            mediaType: kind
        });
        const lwf = makeLightweightFingerprint({ title: payload.title, kind });

        console.log(`[CollectableDiscoveryHook] Processing "${payload.title}" (${source}/${kind})`);
        console.log(`[CollectableDiscoveryHook] Fingerprint: ${fingerprint?.slice(0, 12)}... LWF: ${lwf?.slice(0, 12)}...`);

        // 3. Dedupe check - look for existing collectable
        try {
            let existing = await collectablesQueries.findByLightweightFingerprint(lwf);
            if (!existing && fingerprint) {
                existing = await collectablesQueries.findByFingerprint(fingerprint);
            }

            if (existing) {
                console.log(`[CollectableDiscoveryHook] ✓ Existing collectable found: ${existing.id} "${existing.title}"`);
                return { status: 'exists', collectable: existing };
            }
        } catch (err) {
            console.warn(`[CollectableDiscoveryHook] Dedupe check failed:`, err.message);
        }

        // 4. Upsert new collectable with source attribution
        try {
            const collectable = await collectablesQueries.upsert({
                fingerprint,
                lightweightFingerprint: lwf,
                kind,
                title: payload.title,
                description: payload.description,
                primaryCreator: payload.primaryCreator,
                creators: payload.creators || [],
                publishers: payload.publishers || [],
                year: payload.year,
                formats: payload.formats || [],
                tags: payload.tags || [],
                identifiers: payload.identifiers || {},
                images: payload.images || [],
                coverUrl: payload.coverUrl,
                sources: [{
                    name: source,
                    discoveredAt: new Date().toISOString(),
                    url: originalItem?.source_url || null
                }],
                externalId: payload.externalId,
            });

            console.log(`[CollectableDiscoveryHook] ✓ Created collectable: ${collectable.id} "${collectable.title}"`);
            return { status: 'created', collectable };
        } catch (err) {
            console.error(`[CollectableDiscoveryHook] Upsert failed:`, err.message);
            return { status: 'error', reason: err.message };
        }
    }

    /**
     * Route to source-specific payload builder
     */
    buildPayload({ source, kind, enrichment, originalItem }) {
        switch (source) {
            case 'bluray':
                return this._buildBlurayPayload(enrichment, originalItem);
            case 'igdb':
                return this._buildIgdbPayload(enrichment, originalItem);
            case 'tmdb':
                return this._buildTmdbPayload(enrichment, originalItem);
            default:
                return this._buildGenericPayload(enrichment, originalItem);
        }
    }

    /**
     * Build payload from Bluray + TMDB enrichment
     * @param {Object} tmdbData - TMDB search result
     * @param {Object} blurayItem - Original scraped item { title, source_url, release_date, format }
     */
    _buildBlurayPayload(tmdbData, blurayItem) {
        if (!tmdbData && !blurayItem) return null;

        // If no TMDB match, create minimal payload from scraped data
        if (!tmdbData) {
            return {
                title: blurayItem.title,
                formats: blurayItem.format ? [blurayItem.format] : [],
                identifiers: {
                    bluray_url: blurayItem.source_url
                }
            };
        }

        // Full payload with TMDB enrichment
        const year = tmdbData.release_date ? new Date(tmdbData.release_date).getFullYear() : null;
        const coverUrl = tmdbData.poster_path ? `${this.imageBaseUrl}${tmdbData.poster_path}` : null;

        return {
            title: tmdbData.title || tmdbData.original_title || blurayItem.title,
            description: tmdbData.overview || null,
            year,
            coverUrl,
            images: coverUrl ? [{ url: coverUrl, type: 'poster' }] : [],
            formats: blurayItem.format ? [blurayItem.format] : [],
            tags: [], // Could map genre_ids to genre names
            identifiers: {
                tmdb: tmdbData.id ? String(tmdbData.id) : null,
                bluray_url: blurayItem.source_url
            },
            externalId: tmdbData.id ? `tmdb:${tmdbData.id}` : null
        };
    }

    /**
     * Build payload from IGDB enrichment
     * @param {Object} igdbData - IGDB API result
     * @param {Object} originalItem - Original news item
     */
    _buildIgdbPayload(igdbData, originalItem) {
        if (!igdbData) return this._buildGenericPayload(null, originalItem);

        const year = igdbData.first_release_date
            ? new Date(igdbData.first_release_date * 1000).getFullYear()
            : null;

        return {
            title: igdbData.name || originalItem?.title,
            description: igdbData.summary || null,
            primaryCreator: igdbData.involved_companies?.[0]?.company?.name || null,
            year,
            coverUrl: igdbData.cover?.url || null,
            images: igdbData.cover?.url ? [{ url: igdbData.cover.url, type: 'cover' }] : [],
            formats: igdbData.platforms?.map(p => p.name) || [],
            tags: igdbData.genres?.map(g => g.name) || [],
            identifiers: {
                igdb: igdbData.id ? String(igdbData.id) : null
            },
            externalId: igdbData.id ? `igdb:${igdbData.id}` : null
        };
    }

    /**
     * Build payload from direct TMDB data (non-Bluray source)
     * @param {Object} tmdbData - TMDB API result
     * @param {Object} originalItem - Original news item
     */
    _buildTmdbPayload(tmdbData, originalItem) {
        if (!tmdbData) return this._buildGenericPayload(null, originalItem);

        const year = tmdbData.release_date
            ? new Date(tmdbData.release_date).getFullYear()
            : tmdbData.first_air_date
                ? new Date(tmdbData.first_air_date).getFullYear()
                : null;

        const coverUrl = tmdbData.poster_path ? `${this.imageBaseUrl}${tmdbData.poster_path}` : null;

        return {
            title: tmdbData.title || tmdbData.name || tmdbData.original_title || originalItem?.title,
            description: tmdbData.overview || null,
            year,
            coverUrl,
            images: coverUrl ? [{ url: coverUrl, type: 'poster' }] : [],
            tags: [], // Could map genre_ids
            identifiers: {
                tmdb: tmdbData.id ? String(tmdbData.id) : null
            },
            externalId: tmdbData.id ? `tmdb:${tmdbData.id}` : null
        };
    }

    /**
     * Generic fallback payload builder
     * @param {Object} enrichment - Any enrichment data
     * @param {Object} originalItem - Original news item
     */
    _buildGenericPayload(enrichment, originalItem) {
        const data = enrichment || originalItem || {};
        return {
            title: data.title || data.name || null,
            description: data.description || data.overview || data.summary || null,
            primaryCreator: data.primaryCreator || data.creator || data.author || null,
            year: data.year || data.releaseYear || null,
            coverUrl: data.coverUrl || data.cover_image_url || data.poster_path || null,
            images: [],
            formats: [],
            tags: [],
            identifiers: {},
            externalId: data.external_id || null
        };
    }
}

// Singleton instance
let instance = null;

function getCollectableDiscoveryHook(options) {
    if (!instance) {
        instance = new CollectableDiscoveryHook(options);
    }
    return instance;
}

module.exports = {
    CollectableDiscoveryHook,
    getCollectableDiscoveryHook
};
