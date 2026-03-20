const fetch = require('node-fetch');
const { makeLightweightFingerprint } = require('../../collectables/fingerprint');
const { discogsToCollectable } = require('../../../adapters/discogs.adapter');
const { withTimeout } = require('../../../utils/withTimeout');
const RateLimiter = require('../../../utils/RateLimiter');

const AbortController =
  (globalThis && globalThis.AbortController) || fetch.AbortController || null;

const DEFAULT_BASE_URL = 'https://api.discogs.com';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRIES = 2;
const DEFAULT_LOOKUP_TIMEOUT_MS = 15000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 55;
const USER_AGENT = 'ShelvesAI/1.0 (+https://shelvesai.com)';

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeCompare(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function extractYear(value) {
  if (!value) return null;
  const match = String(value).match(/\b(\d{4})\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function makeDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DiscogsAdapter {
  constructor(options = {}) {
    this.name = 'discogs';
    this.baseUrl =
      normalizeString(options.baseUrl || process.env.DISCOGS_BASE_URL) || DEFAULT_BASE_URL;
    this.timeoutMs = Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : Number.parseInt(process.env.DISCOGS_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS;
    this.retries = Number.isFinite(options.retries)
      ? options.retries
      : Number.parseInt(process.env.DISCOGS_RETRIES || '', 10) || DEFAULT_RETRIES;
    this.lookupTimeoutMs = Number.isFinite(options.lookupTimeoutMs)
      ? options.lookupTimeoutMs
      : Number.parseInt(process.env.DISCOGS_LOOKUP_TIMEOUT_MS || '', 10) ||
        DEFAULT_LOOKUP_TIMEOUT_MS;

    this.userToken = normalizeString(options.userToken || process.env.DISCOGS_USER_TOKEN);
    this.consumerKey = normalizeString(
      options.consumerKey || process.env.DISCOGS_CONSUMER_KEY,
    );
    this.consumerSecret = normalizeString(
      options.consumerSecret || process.env.DISCOGS_CONSUMER_SECRET,
    );

    this.fetch = typeof options.fetch === 'function' ? options.fetch : fetch;
    this.delayFn = typeof options.delayFn === 'function' ? options.delayFn : makeDelay;

    const rateLimit = Number.isFinite(options.rateLimitPerMinute)
      ? options.rateLimitPerMinute
      : Number.parseInt(process.env.DISCOGS_RATE_LIMIT_PER_MINUTE || '', 10) ||
        DEFAULT_RATE_LIMIT_PER_MINUTE;
    this.limiter = new RateLimiter(Math.max(1, rateLimit), 60);
  }

  isConfigured() {
    if (this.userToken) return true;
    return Boolean(this.consumerKey && this.consumerSecret);
  }

  _buildAuthHeader() {
    if (this.userToken) {
      return `Discogs token=${this.userToken}`;
    }
    if (this.consumerKey && this.consumerSecret) {
      return `Discogs key=${this.consumerKey}, secret=${this.consumerSecret}`;
    }
    return null;
  }

  async lookup(item, options = {}) {
    if (!this.isConfigured()) {
      return null;
    }

    return withTimeout(
      () => this._lookupInternal(item, options),
      this.lookupTimeoutMs,
      '[DiscogsAdapter] lookup',
    );
  }

  async _lookupInternal(item, options = {}) {
    const title = normalizeString(item?.name || item?.title);
    const artist = normalizeString(item?.author || item?.primaryCreator);
    const year = extractYear(item?.year);

    if (!title) {
      return null;
    }

    const retries = Number.isFinite(options.retries) ? options.retries : this.retries;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const primarySearch = await this.search({ title, artist, year, type: 'master' });
        let results = Array.isArray(primarySearch?.results) ? primarySearch.results : [];
        if (!results.length) {
          const secondarySearch = await this.search({ title, artist, year, type: 'release' });
          results = Array.isArray(secondarySearch?.results) ? secondarySearch.results : [];
        }
        if (!results.length) return null;

        const ranked = this.rankMatches(results, { title, artist, year });
        const best = ranked[0] || null;
        if (!best) return null;

        const details = await this.fetchDetails(best);
        if (!details) return null;

        const lwf = makeLightweightFingerprint({
          ...item,
          kind: item?.kind || item?.type || 'album',
        });

        const collectable = discogsToCollectable(details, {
          lightweightFingerprint: lwf,
          sourceUrl: normalizeString(best.uri),
          resultMeta: {
            masterId: best.type === 'master' ? best.id : best.master_id,
            releaseId: best.type === 'release' ? best.id : null,
          },
        });

        if (collectable) {
          collectable.provider = 'discogs';
          collectable._raw = {
            searchResult: best,
            details,
          };
        }

        return collectable;
      } catch (err) {
        const message = String(err?.message || err);
        if (
          (message.includes('429') || message.includes('rate limit') || message.includes('503')) &&
          attempt < retries
        ) {
          const backoff = 500 * Math.pow(2, attempt);
          await this.delayFn(backoff);
          continue;
        }
        if (message.includes('abort') && attempt < retries) {
          const backoff = 500 * (attempt + 1);
          await this.delayFn(backoff);
          continue;
        }
        if (message.includes('404')) {
          return null;
        }
        throw err;
      }
    }

    return null;
  }

  async search({ title, artist, year, type = 'master' }) {
    const params = new URLSearchParams();
    params.set('q', title);
    params.set('type', type);
    params.set('per_page', '10');
    if (artist) params.set('artist', artist);
    if (year && Number.isFinite(year)) params.set('year', String(year));

    const url = `${this.baseUrl.replace(/\/$/, '')}/database/search?${params.toString()}`;
    return this.fetchJson(url);
  }

  async fetchDetails(result) {
    if (!result || result.id == null) return null;
    const endpoint = result.type === 'master' ? 'masters' : 'releases';
    const url = `${this.baseUrl.replace(/\/$/, '')}/${endpoint}/${result.id}`;
    return this.fetchJson(url);
  }

  rankMatches(results, { title, artist, year }) {
    const normalizedTitle = normalizeCompare(title);
    const normalizedArtist = normalizeCompare(artist);
    const candidates = [];

    for (const result of results) {
      if (!result || result.id == null) continue;

      const resultTitleRaw = normalizeString(result.title);
      const [artistPart, ...titleParts] = resultTitleRaw.split(' - ');
      const candidateArtist = normalizeCompare(artistPart);
      const candidateTitle = normalizeCompare(titleParts.join(' - ') || resultTitleRaw);

      let score = 0;
      if (candidateTitle === normalizedTitle) {
        score += 60;
      } else if (
        candidateTitle.includes(normalizedTitle) ||
        normalizedTitle.includes(candidateTitle)
      ) {
        score += 30;
      }

      if (normalizedArtist) {
        if (candidateArtist === normalizedArtist) {
          score += 30;
        } else if (
          candidateArtist.includes(normalizedArtist) ||
          normalizedArtist.includes(candidateArtist)
        ) {
          score += 15;
        }
      }

      if (String(result.type) === 'master') {
        score += 10;
      }

      const yearValue = extractYear(result.year);
      if (year && yearValue) {
        const diff = Math.abs(year - yearValue);
        if (diff === 0) score += 10;
        else if (diff <= 2) score += 5;
      }

      const formatValues = toArray(result.format).map((entry) => normalizeCompare(entry));
      const isVinyl = formatValues.some((entry) => entry.includes('vinyl'));
      if (isVinyl) score += 10;

      if (normalizeString(result.cover_image)) {
        score += 5;
      }

      candidates.push({ ...result, _score: score });
    }

    candidates.sort((a, b) => (b._score || 0) - (a._score || 0));
    return candidates;
  }

  async fetchJson(url) {
    const authHeader = this._buildAuthHeader();
    if (!authHeader) {
      throw new Error('Discogs credentials missing');
    }

    const controller = AbortController ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;
    try {
      const response = await this.limiter.acquire().then(() =>
        this.fetch(url, {
          signal: controller ? controller.signal : undefined,
          headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
            Authorization: authHeader,
          },
        }),
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Discogs request failed with ${response.status}: ${text.slice(0, 200)}`);
      }

      return await response.json();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

module.exports = DiscogsAdapter;
