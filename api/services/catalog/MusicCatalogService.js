const fetch = require('node-fetch');
const { makeCollectableFingerprint } = require('../collectables/fingerprint');
const { musicbrainzReleaseGroupToCollectable } = require('../../adapters/musicbrainz.adapter');
const { supportsShelfType: shelfTypeSupports } = require('../config/shelfTypeResolver');
const { getRequestQueue } = require('./MusicBrainzRequestQueue');
const logger = require('../../logger');

let catalogRouter = null;
function getCatalogRouter() {
  if (!catalogRouter) {
    try {
      const { getCatalogRouter: getRouter } = require('./CatalogRouter');
      catalogRouter = getRouter();
    } catch (err) {
      logger.warn('[MusicCatalogService] CatalogRouter not available:', err.message);
    }
  }
  return catalogRouter;
}

const AbortController =
  (globalThis && globalThis.AbortController) || fetch.AbortController || null;

const MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_CONCURRENCY = 1; // MusicBrainz is rate-limited to 1 req/s
const DEFAULT_RETRIES = 2;
const USER_AGENT = 'ShelvesAI/1.0 (johnandrewnichols@gmail.com)';

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

class MusicCatalogService {
  constructor(options = {}) {
    const enableSecondPass =
      options.enableSecondPass ?? process.env.ENABLE_SHELF_VISION_SECOND_PASS;

    this.enableSecondPass = String(enableSecondPass || 'false')
      .trim()
      .toLowerCase() === 'true';

    const useRouter = options.useRouter ?? process.env.MUSIC_CATALOG_USE_ROUTER;
    this.useRouter = String(useRouter || 'true').trim().toLowerCase() !== 'false';

    this.serviceName = 'musicbrainz';
    this.timeoutMs = Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : Number.parseInt(process.env.MUSICBRAINZ_TIMEOUT_MS || '', 10) ||
      DEFAULT_TIMEOUT_MS;
    this.concurrency = Number.isFinite(options.concurrency)
      ? Math.max(1, options.concurrency)
      : Number.parseInt(process.env.MUSICBRAINZ_CONCURRENCY || '', 10) ||
      DEFAULT_CONCURRENCY;
    this.retries = Number.isFinite(options.retries)
      ? options.retries
      : Number.parseInt(process.env.MUSICBRAINZ_RETRIES || '', 10) ||
      DEFAULT_RETRIES;

    this.fetch = typeof options.fetch === 'function' ? options.fetch : fetch;
    this.delayFn = typeof options.delayFn === 'function' ? options.delayFn : makeDelay;

    // Use the shared MusicBrainz request queue (1 req/s rate limiting)
    this._requestQueue = getRequestQueue();
  }

  async routerLookup(item, retries = DEFAULT_RETRIES) {
    const router = getCatalogRouter();
    if (!router) {
      return this.safeLookup(item, retries, { bypassRouter: true });
    }

    try {
      return await router.lookup(item, 'vinyl', { retries });
    } catch (err) {
      logger.error('[MusicCatalogService.routerLookup] failed:', err?.message || err);
      return null;
    }
  }

  supportsShelfType(type) {
    return shelfTypeSupports(type, 'vinyl');
  }

  shouldRunSecondPass(type, unresolvedCount) {
    return (
      this.enableSecondPass &&
      unresolvedCount > 0 &&
      this.supportsShelfType(type)
    );
  }

  async lookupFirstPass(items = [], options = {}) {
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
          logger.error('[MusicCatalogService.lookupFirstPass] failed', {
            error: err?.message || err,
          });
          results[currentIndex] = { status: 'unresolved', input };
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
  }

  async safeLookup(item, retries = this.retries, options = {}) {
    if (this.useRouter && !options?.bypassRouter) {
      return this.routerLookup(item, retries);
    }

    const title = normalizeString(item?.name || item?.title);
    const artist = normalizeString(item?.author || item?.primaryCreator);
    if (!title && !artist) {
      return null;
    }

    const queryLogContext = pruneObject({ title, artist });

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const search = await this.searchReleaseGroups({ title, artist });
        if (
          !search ||
          !Array.isArray(search['release-groups']) ||
          !search['release-groups'].length
        ) {
          return null;
        }

        const match = this.pickBestMatch(search['release-groups'], { title, artist });
        if (!match) {
          return null;
        }

        const details = await this.fetchReleaseGroupDetails(match.id);
        if (!details) {
          return null;
        }

        return {
          provider: 'musicbrainz',
          score: match._score || null,
          releaseGroup: details,
          search: {
            query: queryLogContext,
            totalResults: search.count ?? search['release-groups'].length,
          },
        };
      } catch (err) {
        const message = String(err?.message || err);
        if (
          (message.includes('429') ||
            message.includes('503') ||
            message.includes('rate limit')) &&
          attempt < retries
        ) {
          const backoff = 500 * Math.pow(2, attempt);
          logger.warn('[MusicCatalogService.safeLookup] rate limited', {
            attempt,
            backoff,
            query: queryLogContext,
          });
          await this.delayFn(backoff);
          continue;
        }
        if (message.includes('abort') && attempt < retries) {
          const backoff = 500 * (attempt + 1);
          logger.warn('[MusicCatalogService.safeLookup] request aborted', {
            attempt,
            backoff,
            query: queryLogContext,
          });
          await this.delayFn(backoff);
          continue;
        }
        if (message.includes('404')) {
          logger.warn('[MusicCatalogService.safeLookup] details not found', {
            query: queryLogContext,
            attempt,
          });
          return null;
        }
        throw err;
      }
    }

    return null;
  }

  async safeLookupMany(item, limit = 5, retries = this.retries, options = {}) {
    const title = normalizeString(item?.name || item?.title);
    const artist = normalizeString(item?.author || item?.primaryCreator);
    const offset = Number.isFinite(Number(options?.offset)) && Number(options.offset) >= 0
      ? Math.floor(Number(options.offset))
      : 0;
    if (!title && !artist) {
      return [];
    }

    const queryLogContext = pruneObject({ title, artist, offset, limit });

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const search = await this.searchReleaseGroups({ title, artist, limit, offset });
        if (
          !search ||
          !Array.isArray(search['release-groups']) ||
          !search['release-groups'].length
        ) {
          return [];
        }

        const ranked = this.rankMatches(search['release-groups'], { title, artist });
        const topMatches = ranked.slice(0, Math.max(1, limit || 1));
        const results = [];

        for (const match of topMatches) {
          if (!match?.id) continue;
          let details = null;

          for (let detailsAttempt = 0; detailsAttempt <= retries; detailsAttempt++) {
            try {
              details = await this.fetchReleaseGroupDetails(match.id);
              break;
            } catch (err) {
              const message = String(err?.message || err);
              if (
                (message.includes('429') ||
                  message.includes('503') ||
                  message.includes('rate limit')) &&
                detailsAttempt < retries
              ) {
                const backoff = 500 * Math.pow(2, detailsAttempt);
                logger.warn('[MusicCatalogService.safeLookupMany] rate limited', {
                  attempt: detailsAttempt,
                  backoff,
                  query: queryLogContext,
                });
                await this.delayFn(backoff);
                continue;
              }
              if (message.includes('abort') && detailsAttempt < retries) {
                const backoff = 500 * (detailsAttempt + 1);
                logger.warn('[MusicCatalogService.safeLookupMany] request aborted', {
                  attempt: detailsAttempt,
                  backoff,
                  query: queryLogContext,
                });
                await this.delayFn(backoff);
                continue;
              }
              if (message.includes('404')) {
                logger.warn('[MusicCatalogService.safeLookupMany] details not found', {
                  query: queryLogContext,
                  attempt: detailsAttempt,
                });
                break;
              }
              throw err;
            }
          }

          if (!details) continue;
          results.push({
            provider: 'musicbrainz',
            score: match._score || null,
            releaseGroup: details,
            search: {
              query: queryLogContext,
              totalResults: search.count ?? search['release-groups'].length,
            },
          });
        }

        return results;
      } catch (err) {
        const message = String(err?.message || err);
        if (
          (message.includes('429') ||
            message.includes('503') ||
            message.includes('rate limit')) &&
          attempt < retries
        ) {
          const backoff = 500 * Math.pow(2, attempt);
          logger.warn('[MusicCatalogService.safeLookupMany] rate limited', {
            attempt,
            backoff,
            query: queryLogContext,
          });
          await this.delayFn(backoff);
          continue;
        }
        if (message.includes('abort') && attempt < retries) {
          const backoff = 500 * (attempt + 1);
          logger.warn('[MusicCatalogService.safeLookupMany] request aborted', {
            attempt,
            backoff,
            query: queryLogContext,
          });
          await this.delayFn(backoff);
          continue;
        }
        throw err;
      }
    }

    return [];
  }

  async enrichWithOpenAI(unresolved = []) {
    if (!Array.isArray(unresolved) || unresolved.length === 0) return [];
    // MusicBrainz service does not perform OpenAI enrichment.
    return unresolved.map((entry) => ({ status: 'unresolved', input: entry.input }));
  }

  buildCollectablePayload(entry, item, lightweightFingerprint) {
    if (!entry || entry.status !== 'resolved' || !entry.enrichment) return null;

    if (entry.enrichment.__collectable) {
      const collectable = { ...(entry.enrichment.collectable || {}) };
      collectable.kind = collectable.kind || 'album';
      collectable.type = collectable.type || 'album';
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

    if (entry.enrichment.provider === 'musicbrainz' && entry.enrichment.releaseGroup) {
      const payload = musicbrainzReleaseGroupToCollectable(entry.enrichment.releaseGroup, {
        lightweightFingerprint: lightweightFingerprint || null,
        score: entry.enrichment.score,
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

  async searchReleaseGroups({ title, artist, limit = 10, offset = 0 }) {
    // Build Lucene query
    const clauses = [];
    if (title) {
      const escapedTitle = title.replace(/"/g, '\\"');
      clauses.push(`releasegroup:"${escapedTitle}"`);
    }
    if (artist) {
      const escapedArtist = artist.replace(/"/g, '\\"');
      clauses.push(`artist:"${escapedArtist}"`);
    }
    if (!clauses.length) return null;
    const query = clauses.join(' AND ');

    const params = new URLSearchParams();
    params.set('query', query);
    params.set('fmt', 'json');
    const cappedLimit = Math.max(1, Math.min(Number(limit) || 10, 25));
    const normalizedOffset = Math.max(0, Math.floor(Number(offset) || 0));
    params.set('limit', String(cappedLimit));
    params.set('offset', String(normalizedOffset));

    const url = `${MUSICBRAINZ_BASE_URL}/release-group?${params.toString()}`;
    return this.fetchJson(url);
  }

  async fetchReleaseGroupDetails(mbid) {
    const params = new URLSearchParams();
    params.set('inc', 'artist-credits+releases+genres+tags+ratings');
    params.set('fmt', 'json');

    const url = `${MUSICBRAINZ_BASE_URL}/release-group/${mbid}?${params.toString()}`;
    return this.fetchJson(url);
  }

  pickBestMatch(results, { title, artist }) {
    const ranked = this.rankMatches(results, { title, artist });
    return ranked[0] || null;
  }

  rankMatches(results, { title, artist }) {
    const normalizedTitle = normalizeCompare(title);
    const normalizedArtist = artist ? normalizeCompare(artist) : null;
    const candidates = [];

    for (const result of results) {
      if (!result || !result.id) continue;

      const candidateTitle = result.title || '';
      const normalizedCandidate = normalizeCompare(candidateTitle);

      let score = 0;

      // Title matching
      if (normalizedTitle) {
        if (normalizedCandidate === normalizedTitle) {
          score += 50;
        } else if (
          normalizedCandidate.includes(normalizedTitle) ||
          normalizedTitle.includes(normalizedCandidate)
        ) {
          score += 25;
        }
      }

      // Artist matching against artist-credit names
      if (normalizedArtist) {
        const artistCredit = Array.isArray(result['artist-credit'])
          ? result['artist-credit']
          : [];
        const creditNames = artistCredit
          .filter((c) => c && typeof c === 'object' && c.artist)
          .map((c) => normalizeCompare(c.name || c.artist.name || ''));

        for (const creditName of creditNames) {
          if (!creditName) continue;
          if (creditName === normalizedArtist) {
            score += 30;
            break;
          } else if (
            creditName.includes(normalizedArtist) ||
            normalizedArtist.includes(creditName)
          ) {
            score += 15;
            break;
          }
        }
      }

      // Has first-release-date
      if (result['first-release-date']) {
        score += 5;
      }

      // API score field (0-100) — add score / 10
      if (typeof result.score === 'number') {
        score += result.score / 10;
      } else if (typeof result.score === 'string') {
        const parsed = Number.parseFloat(result.score);
        if (Number.isFinite(parsed)) {
          score += parsed / 10;
        }
      }

      // Primary type is "Album"
      if (result['primary-type'] === 'Album') {
        score += 10;
      }

      candidates.push({ ...result, _score: score });
    }

    candidates.sort((a, b) => (b._score || 0) - (a._score || 0));
    return candidates;
  }

  async fetchJson(url) {
    return this._requestQueue.enqueue(async () => {
      const controller = AbortController ? new AbortController() : null;
      const timeout = controller
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : null;
      try {
        const response = await this.fetch(url, {
          signal: controller ? controller.signal : undefined,
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json',
          },
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `MusicBrainz request failed with ${response.status}: ${text.slice(0, 200)}`
          );
        }
        return await response.json();
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    });
  }
}

module.exports = { MusicCatalogService };
