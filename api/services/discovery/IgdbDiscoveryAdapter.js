/**
 * IgdbDiscoveryAdapter - Fetches popular and trending games from IGDB
 *
 * Uses IGDB's Popularity Primitives API for real-time trending data.
 * See: https://api-docs.igdb.com/#how-to-use-popularity-api
 *
 * Popularity Types:
 *   1 = IGDB Visits (trending page visits)
 *   2 = Want to Play (anticipated games)
 *   3 = Playing (currently being played)
 *   4 = Played (completed)
 *   5 = Steam 24hr Peak Players
 *   6 = Steam Positive Reviews
 *   7 = Steam Negative Reviews
 *   8 = Steam Total Reviews
 */

const fetch = require('node-fetch');
const { resolveShelfType } = require('../config/shelfTypeResolver');

// Get canonical type at module load (cached)
const GAMES_CATEGORY = resolveShelfType('game');

const IGDB_BASE_URL = 'https://api.igdb.com/v4';
const IGDB_AUTH_URL = 'https://id.twitch.tv/oauth2/token';
const DEFAULT_TIMEOUT_MS = 10000;

// Popularity type IDs from IGDB API
const POPULARITY_TYPES = {
  IGDB_VISITS: 1,
  WANT_TO_PLAY: 2,
  PLAYING: 3,
  PLAYED: 4,
  STEAM_PEAK_PLAYERS: 5,
  STEAM_POSITIVE_REVIEWS: 6,
  STEAM_NEGATIVE_REVIEWS: 7,
  STEAM_TOTAL_REVIEWS: 8
};

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
   * Fetch trending games based on IGDB page visits (real-time popularity)
   */
  async fetchTrendingGames(limit = 20) {
    const gameIds = await this._getPopularGameIds(POPULARITY_TYPES.IGDB_VISITS, limit);
    if (!gameIds.length) return [];

    const games = await this._fetchGamesByIds(gameIds);
    return this._normalizeGames(games, 'trending');
  }

  /**
   * Fetch upcoming games based on release_dates (IGDB "coming soon" style)
   */
  async fetchAnticipatedGames(limit = 20) {
    const gameIds = await this._getComingSoonGameIds(limit);
    if (!gameIds.length) return [];

    const games = await this._fetchGamesByIds(gameIds);
    return this._normalizeGames(games, 'upcoming');
  }

  /**
   * Fetch recently released games (sorted by release date descending)
   */
  async fetchRecentReleases(limit = 20) {
    const now = Math.floor(Date.now() / 1000);
    const query = `
      fields name, summary, cover.image_id, first_release_date,
             involved_companies.company.name, involved_companies.developer,
             genres.name, total_rating, total_rating_count;
      where cover != null & first_release_date != null & first_release_date < ${now};
      sort first_release_date desc;
      limit ${limit};
    `;

    const results = await this._callIgdb('games', query);
    return this._normalizeGames(results || [], 'recent');
  }

  /**
   * Fetch currently popular games based on "Playing" status or Steam peak players
   */
  async fetchNowPlayingGames(limit = 20) {
    // Try Steam peak players first for active player data
    let gameIds = await this._getPopularGameIds(POPULARITY_TYPES.STEAM_PEAK_PLAYERS, limit);

    // Fall back to IGDB "Playing" if Steam data is insufficient
    if (gameIds.length < limit / 2) {
      const igdbPlayingIds = await this._getPopularGameIds(POPULARITY_TYPES.PLAYING, limit);
      // Merge and dedupe, prioritizing Steam data
      const existingSet = new Set(gameIds);
      for (const id of igdbPlayingIds) {
        if (!existingSet.has(id) && gameIds.length < limit) {
          gameIds.push(id);
        }
      }
    }

    if (!gameIds.length) return [];

    const games = await this._fetchGamesByIds(gameIds);
    return this._normalizeGames(games, 'now_playing');
  }

  // Legacy method aliases for backward compatibility
  async fetchTopRatedGames(limit = 20) {
    return this.fetchTrendingGames(limit);
  }

  async fetchMostFollowedGames(limit = 20) {
    return this.fetchAnticipatedGames(limit);
  }

  async fetchPopularGames(limit = 20) {
    return this.fetchNowPlayingGames(limit);
  }

  /**
   * Get top game IDs from popularity primitives API
   * @param {number} popularityType - The popularity type ID (1-8)
   * @param {number} limit - Number of results to fetch
   * @returns {number[]} Array of game IDs sorted by popularity
   */
  async _getPopularGameIds(popularityType, limit) {
    const query = `
      fields game_id, value, popularity_type;
      where popularity_type = ${popularityType};
      sort value desc;
      limit ${limit};
    `;

    const results = await this._callIgdb('popularity_primitives', query);
    if (!results || !Array.isArray(results)) return [];

    return results.map(r => r.game_id).filter(Boolean);
  }

  /**
   * Fetch upcoming game IDs using release_dates (coming soon page behavior)
   */
  async _getComingSoonGameIds(limit) {
    const now = Math.floor(Date.now() / 1000);
    const queryLimit = Math.max(limit * 4, limit);
    const query = `
      fields game, date;
      where game != null & date != null & date >= ${now};
      sort date asc;
      limit ${queryLimit};
    `;

    const results = await this._callIgdb('release_dates', query);
    if (!results || !Array.isArray(results)) return [];

    const gameIds = [];
    const seen = new Set();
    for (const row of results) {
      const gameId = row.game;
      if (!gameId || seen.has(gameId)) continue;
      seen.add(gameId);
      gameIds.push(gameId);
      if (gameIds.length >= limit) break;
    }

    return gameIds;
  }

  /**
   * Fetch full game details for a list of game IDs
   * @param {number[]} gameIds - Array of IGDB game IDs
   * @returns {object[]} Array of game objects with full details
   */
  async _fetchGamesByIds(gameIds) {
    if (!gameIds.length) return [];

    const idsString = gameIds.join(',');
    const query = `
      fields name, summary, cover.image_id, first_release_date, release_dates.date,
             involved_companies.company.name, involved_companies.developer,
             genres.name, total_rating, total_rating_count, follows, hypes;
      where id = (${idsString});
      limit ${gameIds.length};
    `;

    const results = await this._callIgdb('games', query);
    if (!results) return [];

    // Preserve the popularity order from the original gameIds array
    const gameMap = new Map(results.map(g => [g.id, g]));
    return gameIds.map(id => gameMap.get(id)).filter(Boolean);
  }

  /**
   * Fetch all game content from all popularity sources
   */
  async fetchAll() {
    const [trending, anticipated, recent, nowPlaying] = await Promise.all([
      this.fetchTrendingGames(),
      this.fetchAnticipatedGames(),
      this.fetchRecentReleases(),
      this.fetchNowPlayingGames()
    ]);
    return [...trending, ...anticipated, ...recent, ...nowPlaying];
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

      const releaseDateSeconds = game.first_release_date
        || (Array.isArray(game.release_dates) && game.release_dates.length
          ? Math.min(...game.release_dates.map(rd => rd?.date).filter(Boolean))
          : null);

      return {
        category: GAMES_CATEGORY,
        item_type: itemType,
        title: game.name,
        description: game.summary || null,
        cover_image_url: game.cover?.image_id ? igdbImageUrl(game.cover.image_id) : null,
        release_date: secondsToDateString(releaseDateSeconds),
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
