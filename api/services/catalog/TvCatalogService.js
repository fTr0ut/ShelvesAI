const fetch = require('node-fetch');
const { makeCollectableFingerprint } = require('../collectables/fingerprint');
const { tmdbTvToCollectable } = require('../../adapters/tmdbTv.adapter');
const { supportsShelfType: shelfTypeSupports } = require('../config/shelfTypeResolver');

const AbortController =
    (globalThis && globalThis.AbortController) || fetch.AbortController || null;


const DEFAULT_BASE_URL = 'https://api.themoviedb.org/3';
const DEFAULT_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RETRIES = 2;

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

function normalizeCompare(value) {
    return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function extractYear(value) {
    if (!value) return null;
    const match = String(value).match(/\b(\d{4})\b/);
    return match ? Number.parseInt(match[1], 10) : null;
}

function makeDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneObject(source) {
    const out = {};
    Object.entries(source || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        out[key] = value;
    });
    return out;
}

class TvCatalogService {
    constructor(options = {}) {
        this.serviceName = 'tmdb-tv';
        this.apiKey =
            normalizeString(options.apiKey || process.env.TMDB_API_KEY) || null;
        this.baseUrl =
            normalizeString(options.baseUrl || process.env.TMDB_BASE_URL) ||
            DEFAULT_BASE_URL;
        this.imageBaseUrl =
            normalizeString(options.imageBaseUrl || process.env.TMDB_IMAGE_BASE_URL) ||
            DEFAULT_IMAGE_BASE_URL;
        this.timeoutMs = Number.isFinite(options.timeoutMs)
            ? options.timeoutMs
            : Number.parseInt(process.env.TMDB_TIMEOUT_MS || '', 10) ||
            DEFAULT_TIMEOUT_MS;
        this.concurrency = Number.isFinite(options.concurrency)
            ? Math.max(1, options.concurrency)
            : Number.parseInt(process.env.TMDB_CONCURRENCY || '', 10) ||
            DEFAULT_CONCURRENCY;
        this.retries = Number.isFinite(options.retries)
            ? options.retries
            : Number.parseInt(process.env.TMDB_RETRIES || '', 10) ||
            DEFAULT_RETRIES;

        this.fetch = typeof options.fetch === 'function' ? options.fetch : fetch;
        this.delayFn = typeof options.delayFn === 'function' ? options.delayFn : makeDelay;

        this._warnedMissingApiKey = false;

        const RateLimiter = require('../../utils/RateLimiter');
        this.limiter = new RateLimiter(35, 1);
    }

    supportsShelfType(type) {
        return shelfTypeSupports(type, 'tv');
    }

    async safeLookup(item, retries = this.retries) {
        const title = normalizeString(item?.name || item?.title);
        const year = extractYear(item?.year);
        const format = normalizeString(item?.format);
        if (!title) {
            return null;
        }

        const queryLogContext = pruneObject({ title, year, format });

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const search = await this.searchTv({ title, year });
                if (!search || !Array.isArray(search.results) || !search.results.length) {
                    return null;
                }

                const match = this.pickBestMatch(search.results, { title, year });
                if (!match) {
                    return null;
                }

                const details = await this.fetchTvDetails(match.id);
                if (!details) {
                    return null;
                }

                return {
                    provider: 'tmdb-tv',
                    score: match._score || null,
                    tv: details,
                    search: {
                        query: queryLogContext,
                        totalResults: search.total_results ?? search.results.length,
                    },
                };
            } catch (err) {
                const message = String(err?.message || err);
                if ((message.includes('429') || message.includes('rate limit')) && attempt < retries) {
                    const backoff = 500 * Math.pow(2, attempt);
                    console.warn('[TvCatalogService.safeLookup] rate limited', {
                        attempt,
                        backoff,
                        query: queryLogContext,
                    });
                    await this.delayFn(backoff);
                    continue;
                }
                if (message.includes('abort') && attempt < retries) {
                    const backoff = 500 * (attempt + 1);
                    console.warn('[TvCatalogService.safeLookup] request aborted', {
                        attempt,
                        backoff,
                        query: queryLogContext,
                    });
                    await this.delayFn(backoff);
                    continue;
                }
                if (message.includes('404')) {
                    console.warn('[TvCatalogService.safeLookup] details not found', {
                        query: queryLogContext,
                        attempt,
                    });
                    return null;
                }
                if (message.includes('401')) {
                    console.error('[TvCatalogService.safeLookup] unauthorized', queryLogContext);
                    return null;
                }
                throw err;
            }
        }

        return null;
    }

    async safeLookupMany(item, limit = 5, retries = this.retries) {
        const title = normalizeString(item?.name || item?.title);
        const year = extractYear(item?.year);
        const format = normalizeString(item?.format);
        if (!title) {
            return [];
        }

        const queryLogContext = pruneObject({ title, year, format });

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const search = await this.searchTv({ title, year });
                if (!search || !Array.isArray(search.results) || !search.results.length) {
                    return [];
                }

                const ranked = this.rankMatches(search.results, { title, year });
                const topMatches = ranked.slice(0, Math.max(1, limit || 1));
                const results = [];

                for (const match of topMatches) {
                    if (!match?.id) continue;
                    let details = null;

                    for (let detailsAttempt = 0; detailsAttempt <= retries; detailsAttempt++) {
                        try {
                            details = await this.fetchTvDetails(match.id);
                            break;
                        } catch (err) {
                            const message = String(err?.message || err);
                            if ((message.includes('429') || message.includes('rate limit')) && detailsAttempt < retries) {
                                const backoff = 500 * Math.pow(2, detailsAttempt);
                                await this.delayFn(backoff);
                                continue;
                            }
                            if (message.includes('abort') && detailsAttempt < retries) {
                                const backoff = 500 * (detailsAttempt + 1);
                                await this.delayFn(backoff);
                                continue;
                            }
                            if (message.includes('404')) {
                                break;
                            }
                            if (message.includes('401')) {
                                return [];
                            }
                            throw err;
                        }
                    }

                    if (!details) continue;
                    results.push({
                        provider: 'tmdb-tv',
                        score: match._score || null,
                        tv: details,
                        search: {
                            query: queryLogContext,
                            totalResults: search.total_results ?? search.results.length,
                        },
                    });
                }

                return results;
            } catch (err) {
                const message = String(err?.message || err);
                if ((message.includes('429') || message.includes('rate limit')) && attempt < retries) {
                    const backoff = 500 * Math.pow(2, attempt);
                    await this.delayFn(backoff);
                    continue;
                }
                if (message.includes('abort') && attempt < retries) {
                    const backoff = 500 * (attempt + 1);
                    await this.delayFn(backoff);
                    continue;
                }
                if (message.includes('401')) {
                    return [];
                }
                throw err;
            }
        }

        return [];
    }

    buildCollectablePayload(entry, item, lightweightFingerprint) {
        if (!entry || entry.status !== 'resolved' || !entry.enrichment) return null;

        if (entry.enrichment.provider === 'tmdb-tv' && entry.enrichment.tv) {
            const payload = tmdbTvToCollectable(entry.enrichment.tv, {
                lightweightFingerprint: lightweightFingerprint || null,
                baseUrl: this.baseUrl,
                imageBaseUrl: this.imageBaseUrl,
                score: entry.enrichment.score,
                format: normalizeString(item?.format),
            });
            if (payload && lightweightFingerprint && !payload.lightweightFingerprint) {
                payload.lightweightFingerprint = lightweightFingerprint;
            }
            if (payload && !payload.fingerprint) {
                payload.fingerprint =
                    makeCollectableFingerprint({
                        title: payload.title,
                        primaryCreator: payload.primaryCreator,
                        releaseYear: payload.year,
                        mediaType: payload.type || payload.kind,
                    }) || null;
            }
            return payload;
        }

        return null;
    }

    async searchTv({ title, year }) {
        const params = new URLSearchParams();
        params.set('query', title);
        params.set('include_adult', 'false');
        if (year && Number.isFinite(year)) {
            params.set('first_air_date_year', String(year));
        }
        params.set('language', 'en-US');
        params.set('page', '1');

        const url = `${this.baseUrl.replace(/\/$/, '')}/search/tv?${params.toString()}`;
        return this.fetchJson(url);
    }

    async fetchTvDetails(id) {
        const params = new URLSearchParams();
        params.set('append_to_response', 'credits,content_ratings,keywords');
        params.set('language', 'en-US');

        const url = `${this.baseUrl.replace(/\/$/, '')}/tv/${id}?${params.toString()}`;
        return this.fetchJson(url);
    }

    pickBestMatch(results, { title, year }) {
        const ranked = this.rankMatches(results, { title, year });
        return ranked[0] || null;
    }

    rankMatches(results, { title, year }) {
        const normalizedTitle = normalizeCompare(title);
        const candidates = [];
        for (const result of results) {
            if (!result || !result.id) continue;
            const candidateTitle = result.name || result.original_name || '';
            const normalizedCandidate = normalizeCompare(candidateTitle);
            const releaseYear = extractYear(result.first_air_date);
            let score = Number(result.popularity) || 0;
            if (normalizedCandidate === normalizedTitle) {
                score += 50;
            } else if (normalizedCandidate.includes(normalizedTitle) || normalizedTitle.includes(normalizedCandidate)) {
                score += 25;
            }
            if (year && releaseYear) {
                const diff = Math.abs(releaseYear - year);
                if (diff === 0) score += 20;
                else if (diff === 1) score += 10;
                else if (diff <= 2) score += 5;
                else score -= diff;
            }
            if (!year && releaseYear) {
                score += 2;
            }
            if (result.vote_count) {
                score += Math.min(result.vote_count / 100, 10);
            }
            if (result.poster_path) score += 2;
            candidates.push({ ...result, _score: score });
        }
        candidates.sort((a, b) => (b._score || 0) - (a._score || 0));
        return candidates;
    }

    async fetchJson(url) {
        const controller = AbortController ? new AbortController() : null;
        const timeout = controller
            ? setTimeout(() => controller.abort(), this.timeoutMs)
            : null;
        try {
            const response = await this.limiter.acquire().then(() => this.fetch(url, {
                signal: controller ? controller.signal : undefined,
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'User-Agent': 'ShelvesAI/1.0 (johnandrewnichols@gmail.com)',
                },
            }));
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`TMDB TV request failed with ${response.status}: ${text.slice(0, 200)}`);
            }
            return await response.json();
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }
}

module.exports = { TvCatalogService };
