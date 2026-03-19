const fetch = require('node-fetch');
const { makeCollectableFingerprint } = require('../collectables/fingerprint');
const { musicbrainzReleaseGroupToCollectable } = require('../../adapters/musicbrainz.adapter');
const { supportsShelfType: shelfTypeSupports } = require('../config/shelfTypeResolver');
const { getRequestQueue } = require('./MusicBrainzRequestQueue');

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
          console.error('[MusicCatalogService.lookupFirstPass] failed', {
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
    const artist = normalizeString(item?.author || item?.primaryCreator);
    if (!title) {
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
          console.warn('[MusicCatalogService.safeLookup] rate limited', {
            attempt,
            backoff,
            query: queryLogContext,
          });
          await this.delayFn(backoff);
          continue;
        }
        if (message.includes('abort') && attempt < retries) {
          const backoff = 500 * (attempt + 1);
          console.warn('[MusicCatalogService.safeLookup] request aborted', {
            attempt,
            backoff,
            query: queryLogContext,
          });
          await this.delayFn(backoff);
          continue;
        }
        if (message.includes('404')) {
          console.warn('[MusicCatalogService.safeLookup] details not found', {
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

  async safeLookupMany(item, limit = 5, retries = this.retries) {
    const title = normalizeString(item?.name || item?.title);
    const artist = normalizeString(item?.author || item?.primaryCreator);
    if (!title) {
      return [];
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
                console.warn('[MusicCatalogService.safeLookupMany] rate limited', {
                  attempt: detailsAttempt,
                  backoff,
                  query: queryLogContext,
                });
                await this.delayFn(backoff);
                continue;
              }
              if (message.includes('abort') && detailsAttempt < retries) {
                const backoff = 500 * (detailsAttempt + 1);
                console.warn('[MusicCatalogService.safeLookupMany] request aborted', {
                  attempt: detailsAttempt,
                  backoff,
                  query: queryLogContext,
                });
                await this.delayFn(backoff);
                continue;
              }
              if (message.includes('404')) {
                console.warn('[MusicCatalogService.safeLookupMany] details not found', {
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
          console.warn('[MusicCatalogService.safeLookupMany] rate limited', {
            attempt,
            backoff,
            query: queryLogContext,
          });
          await this.delayFn(backoff);
          continue;
        }
        if (message.includes('abort') && attempt < retries) {
          const backoff = 500 * (attempt + 1);
          console.warn('[MusicCatalogService.safeLookupMany] request aborted', {
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

  async searchReleaseGroups({ title, artist }) {
    // Build Lucene query
    const escapedTitle = title.replace(/"/g, '\\"');
    let query = `releasegroup:"${escapedTitle}"`;
    if (artist) {
      const escapedArtist = artist.replace(/"/g, '\\"');
      query += ` AND artist:"${escapedArtist}"`;
    }

    const params = new URLSearchParams();
    params.set('query', query);
    params.set('fmt', 'json');
    params.set('limit', '10');

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
      if (normalizedCandidate === normalizedTitle) {
        score += 50;
      } else if (
        normalizedCandidate.includes(normalizedTitle) ||
        normalizedTitle.includes(normalizedCandidate)
      ) {
        score += 25;
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
