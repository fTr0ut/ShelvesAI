const fetch = require('node-fetch');
const { makeCollectableFingerprint } = require('../collectables/fingerprint');
const { tmdbMovieToCollectable } = require('../../adapters/tmdb.adapter');
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

    // TMDB limit: 40 requests per second typically
    // We set a safe margin, e.g. 35 per 1s, or just use the 40.
    const RateLimiter = require('../../utils/RateLimiter');
const logger = require('../../logger');
    this.limiter = new RateLimiter(35, 1);
  }

  supportsShelfType(type) {
    return shelfTypeSupports(type, 'movies');
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
        logger.warn('[MovieCatalogService] TMDB API key missing; skipping lookups');
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
          logger.error('[MovieCatalogService.lookupFirstPass] failed', {
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
    if (!title && !director) {
      return null;
    }

    const results = await this.safeLookupMany(item, 1, retries, { offset: 0 });
    return results[0] || null;
  }

  async safeLookupMany(item, limit = 5, retries = this.retries, options = {}) {
    const title = normalizeString(item?.name || item?.title);
    const director = normalizeString(item?.author || item?.primaryCreator);
    const year = extractYear(item?.year);
    const format = normalizeString(item?.format);
    const offset = Number.isFinite(Number(options?.offset)) && Number(options.offset) >= 0
      ? Math.floor(Number(options.offset))
      : 0;
    if (!title && !director) {
      return [];
    }

    const queryLogContext = pruneObject({ title, director, year, format, offset, limit });

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        let topMatches = [];
        let totalResults = 0;
        if (title) {
          const pageSize = 20;
          let remaining = Math.max(1, limit || 1);
          let providerOffset = offset;
          let page = Math.floor(providerOffset / pageSize) + 1;
          let inPageOffset = providerOffset % pageSize;
          let exhausted = false;

          while (remaining > 0 && !exhausted) {
            const search = await this.searchMovie({ title, year, page });
            if (!search || !Array.isArray(search.results) || !search.results.length) {
              break;
            }
            totalResults = search.total_results ?? totalResults;
            const ranked = this.rankMatches(search.results, { title, year });
            if (!ranked.length) {
              exhausted = true;
              break;
            }

            const pageSlice = ranked.slice(inPageOffset, inPageOffset + remaining);
            topMatches.push(...pageSlice);
            remaining -= pageSlice.length;
            inPageOffset = 0;
            page += 1;

            const totalPages = Number.isFinite(search.total_pages) ? search.total_pages : null;
            if (totalPages && page > totalPages) exhausted = true;
            if (pageSlice.length === 0) exhausted = true;
          }
        } else {
          const directorMatches = await this.searchMoviesByDirector({
            director,
            year,
            limit: Math.max(1, limit || 1),
            offset,
          });
          if (!directorMatches.length) return [];
          topMatches = directorMatches.slice(0, Math.max(1, limit || 1));
          totalResults = directorMatches.length;
        }

        const results = [];

        for (const match of topMatches) {
          if (!match?.id) continue;
          let details = null;

          for (let detailsAttempt = 0; detailsAttempt <= retries; detailsAttempt++) {
            try {
              details = await this.fetchMovieDetails(match.id);
              break;
            } catch (err) {
              const message = String(err?.message || err);
              if ((message.includes('429') || message.includes('rate limit')) && detailsAttempt < retries) {
                const backoff = 500 * Math.pow(2, detailsAttempt);
                logger.warn('[MovieCatalogService.safeLookupMany] rate limited', {
                  attempt: detailsAttempt,
                  backoff,
                  query: queryLogContext,
                });
                await this.delayFn(backoff);
                continue;
              }
              if (message.includes('abort') && detailsAttempt < retries) {
                const backoff = 500 * (detailsAttempt + 1);
                logger.warn('[MovieCatalogService.safeLookupMany] request aborted', {
                  attempt: detailsAttempt,
                  backoff,
                  query: queryLogContext,
                });
                await this.delayFn(backoff);
                continue;
              }
              if (message.includes('404')) {
                logger.warn('[MovieCatalogService.safeLookupMany] details not found', {
                  query: queryLogContext,
                  attempt: detailsAttempt,
                });
                break;
              }
              if (message.includes('401')) {
                logger.error('[MovieCatalogService.safeLookupMany] unauthorized', queryLogContext);
                return [];
              }
              throw err;
            }
          }

          if (!details) continue;
          const directorScore = this.scoreDirectorMatch(details, director);
          const mergedScore = Number(match?._score || 0) + directorScore;
          results.push({
            provider: 'tmdb',
            score: Number.isFinite(mergedScore) ? mergedScore : (match._score || null),
            movie: details,
            search: {
              query: queryLogContext,
              totalResults,
            },
          });
        }

        results.sort((a, b) => (b?.score || 0) - (a?.score || 0));
        return results;
      } catch (err) {
        const message = String(err?.message || err);
        if ((message.includes('429') || message.includes('rate limit')) && attempt < retries) {
          const backoff = 500 * Math.pow(2, attempt);
          logger.warn('[MovieCatalogService.safeLookupMany] rate limited', {
            attempt,
            backoff,
            query: queryLogContext,
          });
          await this.delayFn(backoff);
          continue;
        }
        if (message.includes('abort') && attempt < retries) {
          const backoff = 500 * (attempt + 1);
          logger.warn('[MovieCatalogService.safeLookupMany] request aborted', {
            attempt,
            backoff,
            query: queryLogContext,
          });
          await this.delayFn(backoff);
          continue;
        }
        if (message.includes('401')) {
          logger.error('[MovieCatalogService.safeLookupMany] unauthorized', queryLogContext);
          return [];
        }
        throw err;
      }
    }

    return [];
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

  async searchMovie({ title, year, page = 1 }) {
    const params = new URLSearchParams();
    params.set('query', title);
    params.set('include_adult', 'false');
    if (year && Number.isFinite(year)) {
      params.set('year', String(year));
      params.set('primary_release_year', String(year));
    }
    params.set('language', 'en-US');
    params.set('page', String(Math.max(1, Number(page) || 1)));

    const url = `${this.baseUrl.replace(/\/$/, '')}/search/movie?${params.toString()}`;
    return this.fetchJson(url);
  }

  async searchPerson({ name }) {
    const personName = normalizeString(name);
    if (!personName) return null;
    const params = new URLSearchParams();
    params.set('query', personName);
    params.set('include_adult', 'false');
    params.set('language', 'en-US');
    params.set('page', '1');

    const url = `${this.baseUrl.replace(/\/$/, '')}/search/person?${params.toString()}`;
    return this.fetchJson(url);
  }

  async fetchPersonMovieCredits(personId) {
    if (!personId) return null;
    const params = new URLSearchParams();
    params.set('language', 'en-US');
    const url = `${this.baseUrl.replace(/\/$/, '')}/person/${personId}/movie_credits?${params.toString()}`;
    return this.fetchJson(url);
  }

  async searchMoviesByDirector({ director, year, limit = 5, offset = 0 }) {
    const personSearch = await this.searchPerson({ name: director });
    const people = Array.isArray(personSearch?.results) ? personSearch.results : [];
    if (!people.length) return [];

    const normalizedDirector = normalizeCompare(director);
    const rankedPeople = people
      .map((person) => {
        const personName = normalizeCompare(person?.name);
        const department = normalizeCompare(person?.known_for_department);
        let score = Number(person?.popularity) || 0;
        if (department === 'directing') score += 20;
        if (personName && normalizedDirector && personName === normalizedDirector) score += 30;
        else if (personName && normalizedDirector && (personName.includes(normalizedDirector) || normalizedDirector.includes(personName))) score += 15;
        return { ...person, _score: score };
      })
      .sort((a, b) => (b?._score || 0) - (a?._score || 0))
      .slice(0, 3);

    const matches = [];
    const seenMovieIds = new Set();
    for (const person of rankedPeople) {
      const credits = await this.fetchPersonMovieCredits(person.id);
      const crew = Array.isArray(credits?.crew) ? credits.crew : [];
      const directed = crew.filter((entry) => normalizeCompare(entry?.job) === 'director');
      for (const entry of directed) {
        if (!entry?.id || seenMovieIds.has(entry.id)) continue;
        const releaseYear = extractYear(entry?.release_date);
        if (year && releaseYear && Math.abs(releaseYear - year) > 2) continue;
        seenMovieIds.add(entry.id);
        let score = Number(entry?.popularity) || 0;
        if (entry?.vote_count) score += Math.min(entry.vote_count / 100, 10);
        if (year && releaseYear) {
          const diff = Math.abs(releaseYear - year);
          if (diff === 0) score += 20;
          else if (diff === 1) score += 10;
          else if (diff <= 2) score += 5;
        }
        score += Number(person?._score || 0) / 5;
        matches.push({
          ...entry,
          _score: score,
        });
      }
    }

    matches.sort((a, b) => (b?._score || 0) - (a?._score || 0));
    const normalizedOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0
      ? Math.floor(Number(offset))
      : 0;
    const expandedLimit = Math.max(1, limit || 1) * 3;
    return matches.slice(normalizedOffset, normalizedOffset + expandedLimit);
  }

  async fetchMovieDetails(id) {
    const params = new URLSearchParams();
    params.set('append_to_response', 'credits,release_dates,keywords');
    params.set('language', 'en-US');

    const url = `${this.baseUrl.replace(/\/$/, '')}/movie/${id}?${params.toString()}`;
    return this.fetchJson(url);
  }

  pickBestMatch(results, { title, year, director }) {
    const ranked = this.rankMatches(results, { title, year, director });
    return ranked[0] || null;
  }

  rankMatches(results, { title, year }) {
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
    return candidates;
  }

  scoreDirectorMatch(details, director) {
    const needle = normalizeCompare(director);
    if (!needle) return 0;
    const crew = Array.isArray(details?.credits?.crew) ? details.credits.crew : [];
    const directors = crew
      .filter((member) => normalizeCompare(member?.job) === 'director')
      .map((member) => normalizeCompare(member?.name))
      .filter(Boolean);
    if (!directors.length) return 0;
    if (directors.includes(needle)) return 40;
    if (directors.some((name) => name.includes(needle) || needle.includes(name))) return 20;
    return -5;
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
        throw new Error(`TMDB request failed with ${response.status}: ${text.slice(0, 200)}`);
      }
      return await response.json();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

module.exports = { MovieCatalogService };
