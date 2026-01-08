const fetch = require('node-fetch');
const { makeCollectableFingerprint } = require('../collectables/fingerprint');
const { tmdbMovieToCollectable } = require('../../adapters/tmdb.adapter');

const AbortController =
  (globalThis && globalThis.AbortController) || fetch.AbortController || null;

const MOVIE_TYPE_HINTS = new Set([
  'movie',
  'movies',
  'film',
  'films',
  'blu-ray',
  'bluray',
  'dvd',
  '4k',
  'uhd',
  'vhs',
]);

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

class MovieCatalogService {
  constructor(options = {}) {
    const enableSecondPass =
      options.enableSecondPass ?? process.env.ENABLE_SHELF_VISION_SECOND_PASS;

    this.enableSecondPass = String(enableSecondPass || 'false')
      .trim()
      .toLowerCase() === 'true';

    this.serviceName = 'tmdb';
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
  }

  supportsShelfType(type) {
    const normalized = normalizeString(type).toLowerCase();
    if (!normalized) return false;
    if (normalized === 'movies' || normalized === 'movie') return true;
    for (const hint of MOVIE_TYPE_HINTS) {
      if (normalized.includes(hint)) return true;
    }
    return false;
  }

  shouldRunSecondPass(type, unresolvedCount) {
    return (
      this.enableSecondPass &&
      unresolvedCount > 0 &&
      this.supportsShelfType(type)
    );
  }

  async lookupFirstPass(items = [], options = {}) {
    if (!this.apiKey) {
      if (!this._warnedMissingApiKey) {
        this._warnedMissingApiKey = true;
        console.warn('[MovieCatalogService] TMDB API key missing; skipping lookups');
      }
      return items.map((input) => ({ status: 'unresolved', input }));
    }

    const concurrency = Math.max(1, options.concurrency || this.concurrency);
    const retries = Number.isFinite(options.retries) ? options.retries : this.retries;
    const results = new Array(items.length);
    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        const currentIndex = index++;
        const input = items[currentIndex];
        try {
          const enrichment = await this.safeLookup(input, retries);
          if (enrichment) {
            results[currentIndex] = {
              status: 'resolved',
              input,
              enrichment,
            };
          } else {
            results[currentIndex] = { status: 'unresolved', input };
          }
        } catch (err) {
          console.error('[MovieCatalogService.lookupFirstPass] failed', {
            error: err?.message || err,
          });
          results[currentIndex] = { status: 'unresolved', input };
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
  }

  async safeLookup(item, retries = this.retries) {
    const title = normalizeString(item?.name || item?.title);
    const director = normalizeString(item?.author || item?.primaryCreator);
    const year = extractYear(item?.year);
    const format = normalizeString(item?.format);
    if (!title) {
      return null;
    }

    const queryLogContext = pruneObject({ title, director, year, format });

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const search = await this.searchMovie({ title, year });
        if (!search || !Array.isArray(search.results) || !search.results.length) {
          return null;
        }

        const match = this.pickBestMatch(search.results, { title, year });
        if (!match) {
          return null;
        }

        const details = await this.fetchMovieDetails(match.id);
        if (!details) {
          return null;
        }

        return {
          provider: 'tmdb',
          score: match._score || null,
          movie: details,
          search: {
            query: queryLogContext,
            totalResults: search.total_results ?? search.results.length,
          },
        };
      } catch (err) {
        const message = String(err?.message || err);
        if ((message.includes('429') || message.includes('rate limit')) && attempt < retries) {
          const backoff = 500 * Math.pow(2, attempt);
          console.warn('[MovieCatalogService.safeLookup] rate limited', {
            attempt,
            backoff,
            query: queryLogContext,
          });
          await this.delayFn(backoff);
          continue;
        }
        if (message.includes('abort') && attempt < retries) {
          const backoff = 500 * (attempt + 1);
          console.warn('[MovieCatalogService.safeLookup] request aborted', {
            attempt,
            backoff,
            query: queryLogContext,
          });
          await this.delayFn(backoff);
          continue;
        }
        if (message.includes('404')) {
          console.warn('[MovieCatalogService.safeLookup] details not found', {
            query: queryLogContext,
            attempt,
          });
          return null;
        }
        if (message.includes('401')) {
          console.error('[MovieCatalogService.safeLookup] unauthorized', queryLogContext);
          return null;
        }
        throw err;
      }
    }

    return null;
  }

  async enrichWithOpenAI(unresolved = [], openaiClient) {
    if (!Array.isArray(unresolved) || unresolved.length === 0) return [];
    if (!openaiClient) return unresolved.map((entry) => ({ status: 'unresolved', input: entry.input }));
    // For now, we do not perform a dedicated movie-specific OpenAI enrichment step.
    return unresolved.map((entry) => ({ status: 'unresolved', input: entry.input }));
  }

  buildCollectablePayload(entry, item, lightweightFingerprint) {
    if (!entry || entry.status !== 'resolved' || !entry.enrichment) return null;

    if (entry.enrichment.__collectable) {
      const collectable = { ...(entry.enrichment.collectable || {}) };
      collectable.kind = collectable.kind || 'movie';
      collectable.type = collectable.type || 'movie';
      collectable.lightweightFingerprint =
        collectable.lightweightFingerprint || lightweightFingerprint || null;
      if (!collectable.fingerprint) {
        collectable.fingerprint =
          makeCollectableFingerprint({
            title: collectable.title,
            primaryCreator: collectable.primaryCreator,
            releaseYear: collectable.year,
            mediaType: collectable.type || collectable.kind,
          }) || null;
      }
      collectable.images = Array.isArray(collectable.images)
        ? collectable.images
        : collectable.images
        ? [collectable.images]
        : [];
      collectable.tags = Array.isArray(collectable.tags)
        ? collectable.tags
        : collectable.tags
        ? [collectable.tags]
        : [];
      collectable.sources = Array.isArray(collectable.sources)
        ? collectable.sources
        : collectable.sources
        ? [collectable.sources]
        : [];
      collectable.identifiers = collectable.identifiers || {};
      collectable.physical = collectable.physical || {};
      return collectable;
    }

    if (entry.enrichment.provider === 'tmdb' && entry.enrichment.movie) {
      const payload = tmdbMovieToCollectable(entry.enrichment.movie, {
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

  async searchMovie({ title, year }) {
    const params = new URLSearchParams();
    params.set('query', title);
    params.set('include_adult', 'false');
    if (year && Number.isFinite(year)) {
      params.set('year', String(year));
      params.set('primary_release_year', String(year));
    }
    params.set('language', 'en-US');
    params.set('page', '1');
    params.set('api_key', this.apiKey);

    const url = `${this.baseUrl.replace(/\/$/, '')}/search/movie?${params.toString()}`;
    return this.fetchJson(url);
  }

  async fetchMovieDetails(id) {
    const params = new URLSearchParams();
    params.set('append_to_response', 'credits,release_dates,keywords');
    params.set('api_key', this.apiKey);
    params.set('language', 'en-US');

    const url = `${this.baseUrl.replace(/\/$/, '')}/movie/${id}?${params.toString()}`;
    return this.fetchJson(url);
  }

  pickBestMatch(results, { title, year }) {
    const normalizedTitle = normalizeCompare(title);
    const candidates = [];
    for (const result of results) {
      if (!result || !result.id) continue;
      const candidateTitle = result.title || result.name || result.original_title || '';
      const normalizedCandidate = normalizeCompare(candidateTitle);
      const releaseYear = extractYear(result.release_date);
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
    return candidates[0] || null;
  }

  async fetchJson(url) {
    const controller = AbortController ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;
    try {
      const response = await this.fetch(url, {
        signal: controller ? controller.signal : undefined,
        headers: {
          'User-Agent': 'CollectorApp/1.0 (+https://collector.example)',
        },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`TMDB request failed with ${response.status}: ${text.slice(0, 200)}`);
      }
      return await response.json();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

module.exports = { MovieCatalogService };
