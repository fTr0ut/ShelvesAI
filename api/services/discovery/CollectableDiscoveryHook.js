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
const { tmdbMovieToCollectable } = require('../../adapters/tmdb.adapter');
const fetch = require('node-fetch');

// Environment toggle for gradual rollout
const HOOK_ENABLED = process.env.COLLECTABLE_DISCOVERY_HOOK_ENABLED !== 'false';

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

function normalizeCreatorList(input) {
    if (input == null) return [];
    const source = Array.isArray(input) ? input : [input];
    const seen = new Set();
    const out = [];
    for (const entry of source) {
        const name = typeof entry === 'string' ? entry : entry?.name;
        const normalized = normalizeString(name);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}

function resolvePrimaryCreator(primaryCreator, creators) {
    const normalized = normalizeString(primaryCreator);
    if (normalized) return normalized;
    return creators[0] || null;
}

class CollectableDiscoveryHook {
    constructor(options = {}) {
        this.enabled = options.enabled ?? HOOK_ENABLED;
        this.imageBaseUrl = options.imageBaseUrl || 'https://image.tmdb.org/t/p/w500';
        this.tmdbApiKey = options.tmdbApiKey || process.env.TMDB_API_KEY || null;
        this.tmdbBaseUrl = options.tmdbBaseUrl || 'https://api.themoviedb.org/3';
        this.fetch = typeof options.fetch === 'function' ? options.fetch : fetch;
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

        // 1. Extract external ID early for deduplication
        const externalId = this._extractExternalId({ source, kind, enrichment, originalItem });

        console.log(`[CollectableDiscoveryHook] Processing "${originalItem?.title || enrichment?.title}" (${source}/${kind})`);

        // 2. FIRST: Check by external ID (most reliable deduplication)
        if (externalId) {
            console.log(`[CollectableDiscoveryHook] Checking external ID: ${externalId}`);
            try {
                const existing = await collectablesQueries.findBySourceId(externalId);
                if (existing) {
                    console.log(`[CollectableDiscoveryHook] ✓ Existing collectable found by external ID: ${existing.id} "${existing.title}"`);
                    return { status: 'exists', collectable: existing };
                }
            } catch (err) {
                console.warn(`[CollectableDiscoveryHook] External ID check failed:`, err.message);
            }
        }

        // 3. For TMDB sources, fetch full movie details to get complete metadata
        let fullEnrichment = enrichment;
        if ((source === 'tmdb' || source === 'bluray') && (kind === 'movie' || kind === 'tv')) {
            const tmdbId = this._extractTmdbId(enrichment, originalItem);
            if (tmdbId && this.tmdbApiKey) {
                console.log(`[CollectableDiscoveryHook] Fetching full TMDB details for ID: ${tmdbId}`);
                const details = await this._fetchTmdbDetails(tmdbId, kind);
                if (details) {
                    fullEnrichment = details;
                }
            }
        }

        // 4. Build collectable payload using source-specific adapter
        const payload = this.buildPayload({ source, kind, enrichment: fullEnrichment, originalItem });
        if (!payload?.title) {
            console.log(`[CollectableDiscoveryHook] Skipping item - no title:`, originalItem?.title);
            return { status: 'skipped', reason: 'no_title' };
        }

        const normalizedCreators = normalizeCreatorList(payload.creators);
        const resolvedPrimaryCreator = resolvePrimaryCreator(
            payload.primaryCreator || payload.primary_creator,
            normalizedCreators,
        );
        if (resolvedPrimaryCreator) {
            payload.primaryCreator = resolvedPrimaryCreator;
        }
        if (resolvedPrimaryCreator && normalizedCreators.length) {
            const hasPrimary = normalizedCreators.some(
                (creator) => creator.toLowerCase() === resolvedPrimaryCreator.toLowerCase(),
            );
            if (!hasPrimary) {
                normalizedCreators.unshift(resolvedPrimaryCreator);
            }
        }
        payload.creators = normalizedCreators;

        // 5. Generate fingerprints for deduplication
        const fingerprint = payload.fingerprint || makeCollectableFingerprint({
            title: payload.title,
            primaryCreator: resolvedPrimaryCreator,
            releaseYear: payload.year,
            mediaType: kind
        });
        const lwf = payload.lightweightFingerprint || makeLightweightFingerprint({
            title: payload.title,
            primaryCreator: resolvedPrimaryCreator,
            kind
        });

        console.log(`[CollectableDiscoveryHook] Fingerprint: ${fingerprint?.slice(0, 12)}... LWF: ${lwf?.slice(0, 12)}...`);

        // 6. Secondary dedupe check - fingerprints (in case external ID check missed it)
        try {
            let existing = await collectablesQueries.findByFingerprint(fingerprint);
            if (!existing) {
                existing = await collectablesQueries.findByLightweightFingerprint(lwf);
            }
            if (!existing && collectablesQueries.findByFuzzyFingerprint) {
                existing = await collectablesQueries.findByFuzzyFingerprint(lwf);
            }

            if (existing) {
                console.log(`[CollectableDiscoveryHook] ✓ Existing collectable found by fingerprint: ${existing.id} "${existing.title}"`);
                return { status: 'exists', collectable: existing };
            }
        } catch (err) {
            console.warn(`[CollectableDiscoveryHook] Fingerprint dedupe check failed:`, err.message);
        }

        // 7. Upsert new collectable with full metadata
        try {
            const collectable = await collectablesQueries.upsert({
                fingerprint,
                lightweightFingerprint: lwf,
                kind,
                title: payload.title,
                description: payload.description,
                primaryCreator: resolvedPrimaryCreator,
                creators: normalizedCreators || [],
                publishers: payload.publishers || [],
                year: payload.year,
                formats: payload.formats || [],
                tags: payload.tags || [],
                genre: payload.genre || null,
                runtime: payload.runtime ?? payload.extras?.runtime ?? null,
                identifiers: payload.identifiers || {},
                images: payload.images || [],
                coverUrl: payload.coverUrl,
                sources: payload.sources || [{
                    name: source,
                    discoveredAt: new Date().toISOString(),
                    url: originalItem?.source_url || null
                }],
                externalId: payload.externalId || externalId,
                // TMDB/IGDB attribution (required by API terms)
                attribution: payload.attribution || null,
            });

            console.log(`[CollectableDiscoveryHook] ✓ Created collectable: ${collectable.id} "${collectable.title}"`);
            return { status: 'created', collectable };
        } catch (err) {
            console.error(`[CollectableDiscoveryHook] Upsert failed:`, err.message);
            return { status: 'error', reason: err.message };
        }
    }

    /**
     * Extract external ID from enrichment/originalItem
     */
    _extractExternalId({ source, kind, enrichment, originalItem }) {
        // Check originalItem first (news items have external_id)
        if (originalItem?.external_id) {
            return originalItem.external_id;
        }

        // Check enrichment for TMDB ID
        if (enrichment?.id) {
            if (source === 'tmdb' || source === 'bluray') {
                return kind === 'tv' ? `tmdb_tv:${enrichment.id}` : `tmdb:${enrichment.id}`;
            }
            if (source === 'igdb') {
                return `igdb:${enrichment.id}`;
            }
        }

        return null;
    }

    /**
     * Extract TMDB ID from enrichment data
     */
    _extractTmdbId(enrichment, originalItem) {
        // Direct TMDB ID
        if (enrichment?.id) return enrichment.id;

        // From external_id format "tmdb:123" or "tmdb_tv:123"
        const externalId = originalItem?.external_id || '';
        if (externalId.startsWith('tmdb:')) {
            return externalId.replace('tmdb:', '');
        }
        if (externalId.startsWith('tmdb_tv:')) {
            return externalId.replace('tmdb_tv:', '');
        }

        // From payload
        if (originalItem?.payload?.tmdb_id) {
            return originalItem.payload.tmdb_id;
        }

        return null;
    }

    /**
     * Fetch full movie/TV details from TMDB API
     * Includes credits, keywords, and release dates for complete metadata
     */
    async _fetchTmdbDetails(id, kind = 'movie') {
        if (!this.tmdbApiKey || !id) return null;

        const endpoint = kind === 'tv' ? 'tv' : 'movie';
        const url = `${this.tmdbBaseUrl}/${endpoint}/${id}?append_to_response=credits,keywords,release_dates&language=en-US`;

        try {
            const response = await this.fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.tmdbApiKey}`,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                console.warn(`[CollectableDiscoveryHook] TMDB details fetch failed: ${response.status}`);
                return null;
            }

            const data = await response.json();
            console.log(`[CollectableDiscoveryHook] ✓ Fetched full TMDB details for "${data.title || data.name}"`);
            return data;
        } catch (err) {
            console.warn(`[CollectableDiscoveryHook] TMDB details fetch error:`, err.message);
            return null;
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
            case 'nyt':
                return this._buildNytBooksPayload(enrichment, originalItem);
            default:
                return this._buildGenericPayload(enrichment, originalItem);
        }
    }

    /**
     * Build payload from Bluray + TMDB enrichment
     * @param {Object} tmdbData - TMDB movie details (full or search result)
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

        // Check if we have full TMDB details (has credits) or just search results
        const hasFullDetails = !!(tmdbData.credits || tmdbData.runtime || tmdbData.imdb_id);

        if (hasFullDetails) {
            // Use the proper adapter for full TMDB data transformation
            const payload = tmdbMovieToCollectable(tmdbData, {
                imageBaseUrl: this.imageBaseUrl.replace('/w500', ''),
                format: blurayItem?.format || null
            });

            if (payload) {
                // Add bluray-specific identifiers
                if (blurayItem?.source_url) {
                    payload.identifiers = payload.identifiers || {};
                    payload.identifiers.bluray_url = blurayItem.source_url;
                }

                // Add format from bluray item
                if (blurayItem?.format) {
                    payload.formats = payload.formats || [];
                    if (!payload.formats.includes(blurayItem.format)) {
                        payload.formats.push(blurayItem.format);
                    }
                }

                return payload;
            }
        }

        // Fallback for search results only (no full details)
        const year = tmdbData.release_date ? new Date(tmdbData.release_date).getFullYear() : null;
        const coverUrl = tmdbData.poster_path
            ? `${this.imageBaseUrl}${tmdbData.poster_path.startsWith('/') ? '' : '/'}${tmdbData.poster_path}`
            : null;

        return {
            title: tmdbData.title || tmdbData.original_title || blurayItem?.title,
            description: tmdbData.overview || null,
            year,
            coverUrl,
            images: coverUrl ? [{
                kind: 'poster',
                urlSmall: `https://image.tmdb.org/t/p/w185${tmdbData.poster_path}`,
                urlMedium: `https://image.tmdb.org/t/p/w342${tmdbData.poster_path}`,
                urlLarge: `https://image.tmdb.org/t/p/w780${tmdbData.poster_path}`,
                provider: 'tmdb'
            }] : [],
            formats: blurayItem?.format ? [blurayItem.format] : [],
            tags: [],
            identifiers: {
                tmdb: { movie: [String(tmdbData.id)] },
                bluray_url: blurayItem?.source_url
            },
            externalId: tmdbData.id ? `tmdb:${tmdbData.id}` : null,
            // TMDB Attribution (required by API terms)
            attribution: tmdbData.id ? {
                linkUrl: `https://www.themoviedb.org/movie/${tmdbData.id}`,
                linkText: 'View on TMDB',
                logoKey: 'tmdb',
                disclaimerText: 'This product uses the TMDB API but is not endorsed or certified by TMDB.'
            } : null
        };
    }

    /**
     * Build payload from IGDB enrichment
     * Handles both raw IGDB API format and normalized news item format
     * @param {Object} igdbData - IGDB API result or payload from normalized item
     * @param {Object} originalItem - Original news item (may contain normalized fields)
     */
    _buildIgdbPayload(igdbData, originalItem) {
        const item = originalItem || {};

        // Handle raw IGDB API format (has 'name' and 'first_release_date' as unix timestamp)
        if (igdbData?.name || igdbData?.first_release_date || igdbData?.id) {
            const year = igdbData.first_release_date
                ? new Date(igdbData.first_release_date * 1000).getFullYear()
                : null;

            // Extract developers and publishers from involved_companies
            const involvedCompanies = Array.isArray(igdbData.involved_companies)
                ? igdbData.involved_companies
                : [];
            const developers = involvedCompanies
                .filter(ic => ic.developer)
                .map(ic => ic.company?.name)
                .filter(Boolean);
            const publishers = involvedCompanies
                .filter(ic => ic.publisher)
                .map(ic => ic.company?.name)
                .filter(Boolean);

            const primaryCreator = developers[0] || publishers[0] || null;
            const creators = [...new Set([...developers, ...publishers])];

            // Extract platforms
            const platforms = Array.isArray(igdbData.platforms)
                ? igdbData.platforms.map(p => p.name || p.abbreviation).filter(Boolean)
                : [];

            // Extract genres
            const genres = Array.isArray(igdbData.genres)
                ? igdbData.genres.map(g => g.name).filter(Boolean)
                : [];

            // Build cover URL (IGDB uses // prefix, need https:)
            let coverUrl = null;
            if (igdbData.cover?.url) {
                coverUrl = igdbData.cover.url.startsWith('//')
                    ? `https:${igdbData.cover.url}`
                    : igdbData.cover.url;
                // Get larger image size
                coverUrl = coverUrl.replace('/t_thumb/', '/t_cover_big/');
            }

            // Build images array with multiple sizes
            const images = [];
            if (igdbData.cover?.url) {
                const baseUrl = igdbData.cover.url.startsWith('//')
                    ? `https:${igdbData.cover.url}`
                    : igdbData.cover.url;
                images.push({
                    kind: 'cover',
                    urlSmall: baseUrl.replace('/t_thumb/', '/t_cover_small/'),
                    urlMedium: baseUrl.replace('/t_thumb/', '/t_cover_big/'),
                    urlLarge: baseUrl.replace('/t_thumb/', '/t_720p/'),
                    provider: 'igdb'
                });
            }

            // Build sources
            const sources = igdbData.id ? [{
                provider: 'igdb',
                ids: { game: String(igdbData.id) },
                urls: {
                    game: `https://www.igdb.com/games/${igdbData.slug || igdbData.id}`,
                    api: `https://api.igdb.com/v4/games/${igdbData.id}`
                },
                fetchedAt: new Date()
            }] : [];

            return {
                kind: 'game',
                type: 'game',
                title: igdbData.name || item.title,
                description: igdbData.summary || igdbData.storyline || null,
                primaryCreator,
                creators,
                publishers,
                year,
                coverUrl,
                images,
                formats: platforms,
                tags: genres,
                genre: genres,
                identifiers: {
                    igdb: { game: [String(igdbData.id)] }
                },
                sources,
                externalId: igdbData.id ? `igdb:${igdbData.id}` : null,
                extras: {
                    platforms,
                    rating: igdbData.rating || null,
                    ratingCount: igdbData.rating_count || null,
                    aggregatedRating: igdbData.aggregated_rating || null,
                    releaseDate: year ? `${year}` : null,
                    slug: igdbData.slug || null
                }
            };
        }

        // Handle normalized news item format (from IgdbDiscoveryAdapter)
        // Parse IGDB ID from external_id (format: "igdb:123")
        const externalId = item.external_id || '';
        const igdbId = externalId.startsWith('igdb:')
            ? externalId.replace('igdb:', '')
            : null;

        const year = item.release_date
            ? new Date(item.release_date).getFullYear()
            : null;

        // Extract poster path for multiple image sizes if possible
        const coverImageUrl = item.cover_image_url || null;

        return {
            kind: 'game',
            type: 'game',
            title: item.title,
            description: item.description || null,
            primaryCreator: item.creators?.[0] || null,
            creators: item.creators || [],
            year,
            coverUrl: coverImageUrl,
            images: coverImageUrl ? [{
                kind: 'cover',
                url: coverImageUrl,
                provider: 'igdb'
            }] : [],
            formats: item.platforms || [],
            tags: item.genres || [],
            genre: item.genres || [],
            identifiers: {
                igdb: igdbId ? { game: [igdbId] } : null
            },
            sources: igdbId ? [{
                provider: 'igdb',
                ids: { game: igdbId },
                urls: { game: `https://www.igdb.com/games/${igdbId}` },
                fetchedAt: new Date()
            }] : [],
            externalId: igdbId ? `igdb:${igdbId}` : null
        };
    }

    /**
     * Build payload from direct TMDB data (non-Bluray source)
     * Handles both raw TMDB API format and normalized news item format
     * @param {Object} tmdbData - TMDB API result or payload from normalized item
     * @param {Object} originalItem - Original news item (may contain normalized fields)
     */
    _buildTmdbPayload(tmdbData, originalItem) {
        const item = originalItem || {};

        // Check if we have full TMDB details (has credits) or just search/list results
        const hasFullDetails = !!(tmdbData?.credits || tmdbData?.runtime || tmdbData?.imdb_id);

        // Handle raw TMDB API format with full details
        if (hasFullDetails && tmdbData?.id) {
            // Determine if this is a TV show
            const isTV = !!(tmdbData.first_air_date || tmdbData.number_of_seasons);

            if (!isTV) {
                // Use the proper adapter for movie transformation
                const payload = tmdbMovieToCollectable(tmdbData, {
                    imageBaseUrl: this.imageBaseUrl.replace('/w500', '')
                });
                if (payload) {
                    return payload;
                }
            } else {
                // TV show - build payload manually (no TV adapter yet)
                return this._buildTvPayload(tmdbData);
            }
        }

        // Handle raw TMDB API format (search/list results without full details)
        if (tmdbData?.id && (tmdbData?.title || tmdbData?.name)) {
            const isTV = !!(tmdbData.first_air_date);
            const year = tmdbData.release_date
                ? new Date(tmdbData.release_date).getFullYear()
                : tmdbData.first_air_date
                    ? new Date(tmdbData.first_air_date).getFullYear()
                    : null;

            const posterPath = tmdbData.poster_path;
            const coverUrl = posterPath
                ? `${this.imageBaseUrl}${posterPath.startsWith('/') ? '' : '/'}${posterPath}`
                : null;

            return {
                title: tmdbData.title || tmdbData.name || tmdbData.original_title || item.title,
                description: tmdbData.overview || null,
                year,
                coverUrl,
                images: posterPath ? [{
                    kind: 'poster',
                    urlSmall: `https://image.tmdb.org/t/p/w185${posterPath}`,
                    urlMedium: `https://image.tmdb.org/t/p/w342${posterPath}`,
                    urlLarge: `https://image.tmdb.org/t/p/w780${posterPath}`,
                    provider: 'tmdb'
                }] : [],
                tags: [],
                identifiers: {
                    tmdb: isTV
                        ? { tv: [String(tmdbData.id)] }
                        : { movie: [String(tmdbData.id)] }
                },
                genre: Array.isArray(tmdbData.genres)
                    ? tmdbData.genres.map(g => g.name).filter(Boolean)
                    : null,
                externalId: isTV ? `tmdb_tv:${tmdbData.id}` : `tmdb:${tmdbData.id}`,
                // TMDB Attribution (required by API terms)
                attribution: {
                    linkUrl: `https://www.themoviedb.org/${isTV ? 'tv' : 'movie'}/${tmdbData.id}`,
                    linkText: `View on TMDB`,
                    logoKey: 'tmdb',
                    disclaimerText: 'This product uses the TMDB API but is not endorsed or certified by TMDB.'
                }
            };
        }

        // Handle normalized news item format (from TmdbDiscoveryAdapter)
        // Parse TMDB ID from external_id (format: "tmdb:123" or "tmdb_tv:123")
        const externalId = item.external_id || '';
        const isTV = externalId.startsWith('tmdb_tv:');
        const tmdbId = externalId.replace(/^tmdb(_tv)?:/, '');

        const year = item.release_date
            ? new Date(item.release_date).getFullYear()
            : null;

        // Extract poster path for multiple image sizes
        const coverImageUrl = item.cover_image_url || null;
        const posterPath = coverImageUrl?.match(/\/w\d+(.+)$/)?.[1];
        const creators = Array.isArray(item.creators) ? item.creators : [];
        const primaryCreator = item.primaryCreator || item.primary_creator || null;

        return {
            title: item.title,
            description: item.description || null,
            primaryCreator,
            creators,
            year,
            coverUrl: coverImageUrl,
            images: posterPath ? [{
                kind: 'poster',
                urlSmall: `https://image.tmdb.org/t/p/w185${posterPath}`,
                urlMedium: `https://image.tmdb.org/t/p/w342${posterPath}`,
                urlLarge: `https://image.tmdb.org/t/p/w780${posterPath}`,
                provider: 'tmdb'
            }] : (coverImageUrl ? [{ url: coverImageUrl, kind: 'poster', provider: 'tmdb' }] : []),
            tags: item.genres || [],
            genre: item.genres || [],
            identifiers: {
                tmdb: isTV
                    ? { tv: [tmdbId] }
                    : { movie: [tmdbId] }
            },
            externalId: tmdbId ? item.external_id : null,
            // TMDB Attribution (required by API terms)
            attribution: tmdbId ? {
                linkUrl: `https://www.themoviedb.org/${isTV ? 'tv' : 'movie'}/${tmdbId}`,
                linkText: 'View on TMDB',
                logoKey: 'tmdb',
                disclaimerText: 'This product uses the TMDB API but is not endorsed or certified by TMDB.'
            } : null
        };
    }

    /**
     * Build payload for TV shows from full TMDB details
     * @param {Object} tmdbData - Full TMDB TV show details
     */
    _buildTvPayload(tmdbData) {
        if (!tmdbData?.id) return null;

        const title = tmdbData.name || tmdbData.original_name || null;
        const year = tmdbData.first_air_date
            ? new Date(tmdbData.first_air_date).getFullYear()
            : null;

        // Extract creators
        const createdBy = Array.isArray(tmdbData.created_by)
            ? tmdbData.created_by.map(c => c.name).filter(Boolean)
            : [];

        // Extract cast from credits
        const cast = Array.isArray(tmdbData.credits?.cast)
            ? tmdbData.credits.cast.slice(0, 6).map(c => c.name).filter(Boolean)
            : [];

        const primaryCreator = createdBy[0] || cast[0] || null;
        const creators = [...new Set([...createdBy, ...cast])];

        // Extract genres
        const genres = Array.isArray(tmdbData.genres)
            ? tmdbData.genres.map(g => g.name).filter(Boolean)
            : [];

        // Extract networks as publishers
        const networks = Array.isArray(tmdbData.networks)
            ? tmdbData.networks.map(n => n.name).filter(Boolean)
            : [];

        const episodeRuntime = Array.isArray(tmdbData.episode_run_time) && tmdbData.episode_run_time.length
            ? tmdbData.episode_run_time[0]
            : null;

        // Build image variants
        const posterPath = tmdbData.poster_path;
        const backdropPath = tmdbData.backdrop_path;
        const images = [];
        if (posterPath) {
            images.push({
                kind: 'poster',
                urlSmall: `https://image.tmdb.org/t/p/w185${posterPath}`,
                urlMedium: `https://image.tmdb.org/t/p/w342${posterPath}`,
                urlLarge: `https://image.tmdb.org/t/p/w780${posterPath}`,
                provider: 'tmdb'
            });
        }
        if (backdropPath) {
            images.push({
                kind: 'backdrop',
                urlSmall: `https://image.tmdb.org/t/p/w185${backdropPath}`,
                urlMedium: `https://image.tmdb.org/t/p/w342${backdropPath}`,
                urlLarge: `https://image.tmdb.org/t/p/w780${backdropPath}`,
                provider: 'tmdb'
            });
        }

        // Build identifiers
        const identifiers = {
            tmdb: { tv: [String(tmdbData.id)] }
        };
        if (tmdbData.external_ids?.imdb_id) {
            identifiers.imdb = [tmdbData.external_ids.imdb_id];
        }

        // Build source info
        const sources = [{
            provider: 'tmdb',
            ids: {
                tv: String(tmdbData.id),
                ...(tmdbData.external_ids?.imdb_id ? { imdb: tmdbData.external_ids.imdb_id } : {})
            },
            urls: {
                tv: `https://www.themoviedb.org/tv/${tmdbData.id}`,
                api: `https://api.themoviedb.org/3/tv/${tmdbData.id}`
            },
            fetchedAt: new Date()
        }];

        return {
            kind: 'tv',
            type: 'tv',
            title,
            description: tmdbData.overview || null,
            primaryCreator,
            creators,
            publishers: networks,
            year,
            runtime: episodeRuntime,
            tags: genres,
            genre: genres,
            identifiers,
            images,
            coverUrl: posterPath ? `https://image.tmdb.org/t/p/w780${posterPath}` : null,
            sources,
            externalId: `tmdb_tv:${tmdbData.id}`,
            extras: {
                numberOfSeasons: tmdbData.number_of_seasons || null,
                numberOfEpisodes: tmdbData.number_of_episodes || null,
                status: tmdbData.status || null,
                firstAirDate: tmdbData.first_air_date || null,
                lastAirDate: tmdbData.last_air_date || null,
                networks,
                originalLanguage: tmdbData.original_language || null
            },
            // TMDB Attribution (required by API terms)
            attribution: {
                linkUrl: `https://www.themoviedb.org/tv/${tmdbData.id}`,
                linkText: 'View on TMDB',
                logoKey: 'tmdb',
                disclaimerText: 'This product uses the TMDB API but is not endorsed or certified by TMDB.'
            }
        };
    }

    /**
     * Build payload from NYT Books API data
     * @param {Object} nytData - NYT enrichment data (payload from news item)
     * @param {Object} originalItem - Original news item
     */
    _buildNytBooksPayload(nytData, originalItem) {
        const data = nytData || {};
        const item = originalItem || {};

        // Extract author from various possible locations
        const author = data.author ||
            (Array.isArray(item.creators) && item.creators[0]) ||
            null;

        // Build ISBN identifiers
        const identifiers = {};
        if (data.primary_isbn13) {
            identifiers.isbn13 = [data.primary_isbn13];
        }
        if (data.primary_isbn10) {
            identifiers.isbn10 = [data.primary_isbn10];
        }

        // Use list name as genre/category
        const genres = item.genres || (data.list_name ? [data.list_name] : []);

        return {
            title: item.title || data.title || null,
            description: item.description || data.description || null,
            primaryCreator: author,
            year: null, // NYT doesn't provide publication year
            coverUrl: item.cover_image_url || null,
            images: item.cover_image_url ? [{ url: item.cover_image_url, type: 'cover' }] : [],
            formats: ['book'],
            tags: [],
            genre: genres.length ? genres[0] : null,
            genres: genres,
            identifiers: identifiers,
            externalId: item.external_id || null,
            publisher: data.publisher || null,
            rank: data.rank || null,
            weeksOnList: data.weeks_on_list || null,
            amazonUrl: data.amazon_product_url || null
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
            genre: data.genre || data.genres || null,
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
