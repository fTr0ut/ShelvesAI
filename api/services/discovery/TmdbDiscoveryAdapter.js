/**
 * TmdbDiscoveryAdapter - Fetches trending, upcoming, and now playing content from TMDB
 *
 * Uses TMDB's discovery endpoints (not search) to populate the news_items cache.
 */

const fetch = require('node-fetch');

const DEFAULT_BASE_URL = 'https://api.themoviedb.org/3';
const DEFAULT_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const DEFAULT_TIMEOUT_MS = 10000;

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

class TmdbDiscoveryAdapter {
  constructor(options = {}) {
    this.apiKey = normalizeString(options.apiKey || process.env.TMDB_API_KEY) || null;
    this.baseUrl = normalizeString(options.baseUrl) || DEFAULT_BASE_URL;
    this.imageBaseUrl = normalizeString(options.imageBaseUrl) || DEFAULT_IMAGE_BASE_URL;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.fetch = typeof options.fetch === 'function' ? options.fetch : fetch;

    // Genre ID to name mapping (TMDB movie genres)
    this.movieGenres = {
      28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
      80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
      14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
      9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie',
      53: 'Thriller', 10752: 'War', 37: 'Western'
    };

    // Genre ID to name mapping (TMDB TV genres)
    this.tvGenres = {
      10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy',
      80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
      10762: 'Kids', 9648: 'Mystery', 10763: 'News', 10764: 'Reality',
      10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk',
      10768: 'War & Politics', 37: 'Western'
    };
  }

  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Fetch trending movies for the week
   */
  async fetchTrendingMovies(limit = 20) {
    const data = await this._fetchJson('/trending/movie/week');
    return this._normalizeMovies(data.results || [], 'trending', limit);
  }

  /**
   * Fetch upcoming movies (US region)
   */
  async fetchUpcomingMovies(limit = 20) {
    const data = await this._fetchJson('/movie/upcoming', { region: 'US' });
    return this._normalizeMovies(data.results || [], 'upcoming', limit);
  }

  /**
   * Fetch now playing movies (US region)
   */
  async fetchNowPlayingMovies(limit = 20) {
    const data = await this._fetchJson('/movie/now_playing', { region: 'US' });
    return this._normalizeMovies(data.results || [], 'now_playing', limit);
  }

  /**
   * Fetch trending TV shows for the week
   */
  async fetchTrendingTV(limit = 20) {
    const data = await this._fetchJson('/trending/tv/week');
    return this._normalizeTV(data.results || [], 'trending', limit);
  }

  /**
   * Fetch TV shows currently on the air
   */
  async fetchOnTheAirTV(limit = 20) {
    const data = await this._fetchJson('/tv/on_the_air');
    return this._normalizeTV(data.results || [], 'now_playing', limit);
  }

  /**
   * Fetch all movie content (trending + upcoming + now playing)
   */
  async fetchAllMovies() {
    const [trending, upcoming, nowPlaying] = await Promise.all([
      this.fetchTrendingMovies(),
      this.fetchUpcomingMovies(),
      this.fetchNowPlayingMovies()
    ]);
    return [...trending, ...upcoming, ...nowPlaying];
  }

  /**
   * Fetch all TV content (trending + on the air)
   */
  async fetchAllTV() {
    const [trending, onAir] = await Promise.all([
      this.fetchTrendingTV(),
      this.fetchOnTheAirTV()
    ]);
    return [...trending, ...onAir];
  }

  /**
   * Fetch everything (movies + TV)
   */
  async fetchAll() {
    const [movies, tv] = await Promise.all([
      this.fetchAllMovies(),
      this.fetchAllTV()
    ]);
    return [...movies, ...tv];
  }

  /**
   * Search for a movie by title and optional year
   */
  async searchMovie({ title, year }) {
    const params = { query: title };
    if (year) {
      params.primary_release_year = year;
    }
    const data = await this._fetchJson('/search/movie', params);
    // Return raw results, caller will handle normalization/matching logic
    return data.results || [];
  }

  _normalizeMovies(results, itemType, limit = 20) {
    return results.slice(0, limit).map(movie => ({
      category: 'movies',
      item_type: itemType,
      title: movie.title || movie.original_title,
      description: movie.overview || null,
      cover_image_url: movie.poster_path ? `${this.imageBaseUrl}${movie.poster_path}` : null,
      release_date: movie.release_date || null,
      creators: [], // Would need additional API call to get director
      franchises: [],
      genres: (movie.genre_ids || []).map(id => this.movieGenres[id]).filter(Boolean),
      external_id: `tmdb:${movie.id}`,
      source_api: 'tmdb',
      source_url: `https://www.themoviedb.org/movie/${movie.id}`,
      payload: {
        vote_average: movie.vote_average,
        vote_count: movie.vote_count,
        popularity: movie.popularity,
        backdrop_path: movie.backdrop_path ? `${this.imageBaseUrl}${movie.backdrop_path}` : null,
        original_language: movie.original_language,
        adult: movie.adult
      }
    }));
  }

  _normalizeTV(results, itemType, limit = 20) {
    return results.slice(0, limit).map(show => ({
      category: 'tv',
      item_type: itemType,
      title: show.name || show.original_name,
      description: show.overview || null,
      cover_image_url: show.poster_path ? `${this.imageBaseUrl}${show.poster_path}` : null,
      release_date: show.first_air_date || null,
      creators: [],
      franchises: [],
      genres: (show.genre_ids || []).map(id => this.tvGenres[id]).filter(Boolean),
      external_id: `tmdb_tv:${show.id}`,
      source_api: 'tmdb',
      source_url: `https://www.themoviedb.org/tv/${show.id}`,
      payload: {
        vote_average: show.vote_average,
        vote_count: show.vote_count,
        popularity: show.popularity,
        backdrop_path: show.backdrop_path ? `${this.imageBaseUrl}${show.backdrop_path}` : null,
        original_language: show.original_language,
        origin_country: show.origin_country
      }
    }));
  }

  async _fetchJson(endpoint, params = {}) {
    if (!this.apiKey) {
      throw new Error('TMDB API key not configured');
    }

    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set('language', 'en-US');
    url.searchParams.set('page', '1');

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`TMDB request failed with ${response.status}: ${text.slice(0, 200)}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = TmdbDiscoveryAdapter;
