/**
 * IgdbDiscoveryAdapter - Fetches popular and recent games from IGDB
 *
 * Uses IGDB's query API to find popular, highly-rated, and recent games.
 */

const fetch = require('node-fetch');

const IGDB_BASE_URL = 'https://api.igdb.com/v4';
const IGDB_AUTH_URL = 'https://id.twitch.tv/oauth2/token';
const DEFAULT_TIMEOUT_MS = 10000;

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function secondsToDateString(timestampSeconds) {
  if (!timestampSeconds) return null;
  const date = new Date(timestampSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function igdbImageUrl(imageId, size = 't_cover_big') {
  if (!imageId) return null;
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}

class IgdbDiscoveryAdapter {
  constructor(options = {}) {
    this.clientId = normalizeString(options.clientId || process.env.IGDB_CLIENT_ID) || null;
    this.clientSecret = normalizeString(options.clientSecret || process.env.IGDB_CLIENT_SECRET) || null;
    this.baseUrl = normalizeString(options.baseUrl) || IGDB_BASE_URL;
    this.authUrl = normalizeString(options.authUrl) || IGDB_AUTH_URL;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.fetch = typeof options.fetch === 'function' ? options.fetch : fetch;

    this._token = null;
    this._tokenExpiresAt = 0;
  }

  isConfigured() {
    return !!(this.clientId && this.clientSecret);
  }

  /**
   * Fetch highly-rated games (sorted by total rating)
   */
  async fetchTopRatedGames(limit = 20) {
    const query = `
      fields name, summary, cover.image_id, first_release_date,
             involved_companies.company.name, involved_companies.developer,
             genres.name, total_rating, total_rating_count, follows;
      where cover != null & total_rating > 85;
      sort total_rating desc;
      limit ${limit};
    `;

    const results = await this._callIgdb('games', query);
    return this._normalizeGames(results || [], 'trending');
  }

  /**
   * Fetch most followed games (indicating high anticipation/popularity)
   */
  async fetchMostFollowedGames(limit = 20) {
    const query = `
      fields name, summary, cover.image_id, first_release_date,
             involved_companies.company.name, involved_companies.developer,
             genres.name, total_rating, follows, hypes;
      where cover != null & follows != null;
      sort follows desc;
      limit ${limit};
    `;

    const results = await this._callIgdb('games', query);
    return this._normalizeGames(results || [], 'upcoming');
  }

  /**
   * Fetch recently released games (sorted by release date descending)
   */
  async fetchRecentReleases(limit = 20) {
    const query = `
      fields name, summary, cover.image_id, first_release_date,
             involved_companies.company.name, involved_companies.developer,
             genres.name, total_rating, total_rating_count;
      where cover != null & first_release_date != null;
      sort first_release_date desc;
      limit ${limit};
    `;

    const results = await this._callIgdb('games', query);
    return this._normalizeGames(results || [], 'recent');
  }

  /**
   * Fetch popular games (high rating count indicates popularity)
   */
  async fetchPopularGames(limit = 20) {
    const query = `
      fields name, summary, cover.image_id, first_release_date,
             involved_companies.company.name, involved_companies.developer,
             genres.name, total_rating, total_rating_count, follows;
      where cover != null & total_rating_count != null;
      sort total_rating_count desc;
      limit ${limit};
    `;

    const results = await this._callIgdb('games', query);
    return this._normalizeGames(results || [], 'now_playing');
  }

  /**
   * Fetch all game content
   */
  async fetchAll() {
    const [topRated, mostFollowed, recent, popular] = await Promise.all([
      this.fetchTopRatedGames(),
      this.fetchMostFollowedGames(),
      this.fetchRecentReleases(),
      this.fetchPopularGames()
    ]);
    return [...topRated, ...mostFollowed, ...recent, ...popular];
  }

  _normalizeGames(results, itemType) {
    return results.map(game => {
      // Extract developers from involved_companies
      const developers = (game.involved_companies || [])
        .filter(ic => ic.developer)
        .map(ic => ic.company?.name)
        .filter(Boolean);

      // Extract genres
      const genres = (game.genres || []).map(g => g.name).filter(Boolean);

      return {
        category: 'games',
        item_type: itemType,
        title: game.name,
        description: game.summary || null,
        cover_image_url: game.cover?.image_id ? igdbImageUrl(game.cover.image_id) : null,
        release_date: secondsToDateString(game.first_release_date),
        creators: developers,
        franchises: [],
        genres,
        external_id: `igdb:${game.id}`,
        source_api: 'igdb',
        source_url: `https://www.igdb.com/games/${this._slugify(game.name)}`,
        payload: {
          hypes: game.hypes || null,
          follows: game.follows || null,
          total_rating: game.total_rating || null,
          total_rating_count: game.total_rating_count || null
        }
      };
    });
  }

  _slugify(name) {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async _getAccessToken(forceRefresh = false) {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('IGDB credentials not configured');
    }

    const now = Date.now();
    if (!forceRefresh && this._token && this._tokenExpiresAt > now + 60000) {
      return this._token;
    }

    const params = new URLSearchParams();
    params.set('client_id', this.clientId);
    params.set('client_secret', this.clientSecret);
    params.set('grant_type', 'client_credentials');

    const response = await this.fetch(this.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`IGDB auth failed with ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    this._token = data.access_token || null;
    this._tokenExpiresAt = data.expires_in
      ? now + Number(data.expires_in) * 1000
      : now + 3600 * 1000;

    return this._token;
  }

  async _callIgdb(endpoint, query) {
    const token = await this._getAccessToken();
    if (!token) return null;

    const url = `${this.baseUrl}/${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(url, {
        method: 'POST',
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'text/plain',
          'Accept': 'application/json'
        },
        body: query,
        signal: controller.signal
      });

      if (response.status === 401) {
        // Token expired, try refreshing
        this._token = null;
        this._tokenExpiresAt = 0;
        const newToken = await this._getAccessToken(true);

        const retryResponse = await this.fetch(url, {
          method: 'POST',
          headers: {
            'Client-ID': this.clientId,
            'Authorization': `Bearer ${newToken}`,
            'Content-Type': 'text/plain',
            'Accept': 'application/json'
          },
          body: query
        });

        if (!retryResponse.ok) {
          const text = await retryResponse.text();
          throw new Error(`IGDB request failed with ${retryResponse.status}: ${text.slice(0, 200)}`);
        }

        return await retryResponse.json();
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`IGDB request failed with ${response.status}: ${text.slice(0, 200)}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = IgdbDiscoveryAdapter;
