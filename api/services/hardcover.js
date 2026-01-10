const fetch = require('node-fetch');
const RateLimiter = require('../utils/RateLimiter');

const AbortController =
  (globalThis && globalThis.AbortController) || fetch.AbortController || null;

const DEFAULT_BASE_URL = 'https://api.hardcover.app/v1/graphql';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_REQUESTS_PER_MINUTE = 55;

const SEARCH_QUERY = `
query HardcoverSearch($query: String!, $queryType: String!, $perPage: Int!, $page: Int!, $fields: String, $weights: String, $sort: String) {
  search(query: $query, query_type: $queryType, per_page: $perPage, page: $page, fields: $fields, weights: $weights, sort: $sort) {
    ids
    results
    query
    query_type
    page
    per_page
  }
}
`;

const BOOK_DETAILS_QUERY = `
query HardcoverBookDetails($ids: [Int!]) {
  books(where: {id: {_in: $ids}}) {
    id
    title
    subtitle
    description
    release_date
    release_year
    slug
    cached_tags
    cached_image
    cached_contributors
    contributions {
      contribution
      author {
        name
      }
    }
    default_physical_edition {
      id
      isbn_13
      isbn_10
      asin
      pages
      release_date
      edition_format
      physical_format
      cached_image
      reading_format {
        format
      }
      language {
        language
      }
      publisher {
        name
      }
    }
  }
}
`;

const EDITION_BY_ISBN_13_QUERY = `
query HardcoverEditionByIsbn13($isbn: String!) {
  editions(where: {isbn_13: {_eq: $isbn}}, order_by: {release_date: desc}, limit: 5) {
    id
    title
    subtitle
    isbn_13
    isbn_10
    asin
    pages
    release_date
    edition_format
    physical_format
    cached_image
    reading_format {
      format
    }
    language {
      language
    }
    publisher {
      name
    }
    book {
      id
      title
      subtitle
      description
      release_date
      release_year
      slug
      cached_tags
      cached_image
      cached_contributors
      contributions {
        contribution
        author {
          name
        }
      }
    }
  }
}
`;

const EDITION_BY_ISBN_10_QUERY = `
query HardcoverEditionByIsbn10($isbn: String!) {
  editions(where: {isbn_10: {_eq: $isbn}}, order_by: {release_date: desc}, limit: 5) {
    id
    title
    subtitle
    isbn_13
    isbn_10
    asin
    pages
    release_date
    edition_format
    physical_format
    cached_image
    reading_format {
      format
    }
    language {
      language
    }
    publisher {
      name
    }
    book {
      id
      title
      subtitle
      description
      release_date
      release_year
      slug
      cached_tags
      cached_image
      cached_contributors
      contributions {
        contribution
        author {
          name
        }
      }
    }
  }
}
`;

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
}

function normalizeCompare(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseJsonMaybe(value) {
  if (!value || typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    return value;
  }
}

function normalizeSearchResults(rawResults) {
  const parsed = parseJsonMaybe(rawResults);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.hits)) {
      return parsed.hits
        .map((hit) => hit?.document || hit?.doc || hit)
        .filter(Boolean);
    }
    if (Array.isArray(parsed.documents)) return parsed.documents.filter(Boolean);
    if (Array.isArray(parsed.results)) return parsed.results.filter(Boolean);
  }
  return [];
}

function normalizeIsbn(value) {
  const raw = normalizeString(value);
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9Xx]/g, '').toUpperCase();
  return cleaned || null;
}

function extractYear(value) {
  if (!value) return null;
  const match = String(value).match(/\b(\d{4})\b/);
  return match ? match[1] : null;
}

function coerceArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

class HardcoverClient {
  constructor(options = {}) {
    this.token = normalizeString(options.token || process.env.HARDCOVER_API_TOKEN) || null;
    this.baseUrl =
      normalizeString(options.baseUrl || process.env.HARDCOVER_API_URL) ||
      DEFAULT_BASE_URL;
    this.timeoutMs = Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : Number.parseInt(process.env.HARDCOVER_TIMEOUT_MS || '', 10) ||
        DEFAULT_TIMEOUT_MS;

    const rpm = Number.isFinite(options.requestsPerMinute)
      ? options.requestsPerMinute
      : Number.parseInt(process.env.HARDCOVER_REQUESTS_PER_MINUTE || '', 10) ||
        DEFAULT_REQUESTS_PER_MINUTE;
    const perMinute = Math.max(1, rpm);

    this.userAgent =
      normalizeString(options.userAgent || process.env.HARDCOVER_USER_AGENT) ||
      'ShelvesAI/1.0 (johnandrewnichols@gmail.com)';

    this.debug =
      options.debug !== undefined
        ? parseBoolean(options.debug)
        : parseBoolean(process.env.HARDCOVER_DEBUG);
    this.debugLogAuth =
      options.debugLogAuth !== undefined
        ? parseBoolean(options.debugLogAuth)
        : parseBoolean(process.env.HARDCOVER_DEBUG_LOG_AUTH);

    this.fetch = typeof options.fetch === 'function' ? options.fetch : fetch;
    this.limiter = new RateLimiter(perMinute, 60);
  }

  isConfigured() {
    return !!this.token;
  }

  async lookupByISBN(isbn) {
    const normalized = normalizeIsbn(isbn);
    if (!normalized || !this.isConfigured()) return null;
    const isIsbn13 = normalized.length === 13;
    const query = isIsbn13 ? EDITION_BY_ISBN_13_QUERY : EDITION_BY_ISBN_10_QUERY;
    const data = await this.fetchGraphQL(query, { isbn: normalized });
    const editions = Array.isArray(data?.editions) ? data.editions : [];
    if (!editions.length) return null;
    const edition = editions[0];
    if (!edition?.book) return null;
    return {
      provider: 'hardcover',
      book: edition.book,
      edition,
      search: {
        isbn: normalized,
        isbnType: isIsbn13 ? 'isbn13' : 'isbn10',
      },
      fetchedAt: new Date().toISOString(),
    };
  }

  async lookupByTitleAuthor({ title, author, limit = 5 } = {}) {
    if (!this.isConfigured()) return null;
    const queryText = normalizeString([title, author].filter(Boolean).join(' '));
    if (!queryText) return null;

    const searchPayload = await this.searchBooks({
      query: queryText,
      limit,
      fields: 'title,isbns,series_names,author_names,alternative_titles',
      weights: '5,5,3,1,1',
      sort: '_text_match:desc,users_count:desc',
    });

    if (
      !searchPayload ||
      (!searchPayload.results.length && !searchPayload.ids.length)
    ) {
      return null;
    }

    const expected = {
      title: normalizeString(title),
      author: normalizeString(author),
    };

    const scored = this.scoreSearchResults(searchPayload, expected);
    const maxCandidates = Math.min(limit, 5);
    const topCandidates = scored.length
      ? scored.slice(0, maxCandidates)
      : searchPayload.ids.slice(0, maxCandidates).map((id) => ({
          id,
          result: null,
          score: null,
        }));
    if (!topCandidates.length) return null;
    const ids = topCandidates.map((entry) => entry.id).filter(Boolean);
    const books = await this.fetchBooksByIds(ids);
    if (!books.length) return null;

    const best = this.pickBestBook(books, expected);
    if (!best) return null;

    const candidateById = new Map(topCandidates.map((entry) => [entry.id, entry]));
    const candidate = candidateById.get(best.id) || null;

    return {
      provider: 'hardcover',
      book: best,
      edition: best.default_physical_edition || null,
      search: {
        query: searchPayload.query || queryText,
        result: candidate ? candidate.result : null,
        score: candidate ? candidate.score : null,
        ids: searchPayload.ids || [],
      },
      fetchedAt: new Date().toISOString(),
    };
  }

  async searchBooks({ query, limit = 5, fields, weights, sort } = {}) {
    const payload = await this.fetchGraphQL(SEARCH_QUERY, {
      query: normalizeString(query),
      queryType: 'Book',
      perPage: Math.max(1, limit),
      page: 1,
      fields,
      weights,
      sort,
    });

    const search = payload?.search || null;
    if (!search) return null;

    const results = normalizeSearchResults(search.results);
    const parsedIds = parseJsonMaybe(search.ids);
    return {
      ids: Array.isArray(parsedIds) ? parsedIds : [],
      results: Array.isArray(results) ? results : [],
      query: search.query || null,
      queryType: search.query_type || null,
      page: search.page || null,
      perPage: search.per_page || null,
    };
  }

  async fetchBooksByIds(ids = []) {
    if (!this.isConfigured()) return [];
    const cleaned = ids
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isFinite(id));
    if (!cleaned.length) return [];
    const payload = await this.fetchGraphQL(BOOK_DETAILS_QUERY, { ids: cleaned });
    return Array.isArray(payload?.books) ? payload.books : [];
  }

  scoreSearchResults(searchPayload, expected) {
    const ids = Array.isArray(searchPayload.ids) ? searchPayload.ids : [];
    const results = Array.isArray(searchPayload.results) ? searchPayload.results : [];
    const scored = [];

    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      const id = result?.id || ids[index];
      if (!id) continue;
      const score = this.scoreSearchResult(result, expected);
      if (score === null) continue;
      scored.push({ id, result, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  scoreSearchResult(result, expected) {
    if (!result) return null;
    const expectedTitle = normalizeCompare(expected.title);
    const title = normalizeCompare(result.title || '');
    let score = 0;
    if (expectedTitle) {
      if (title === expectedTitle) score += 100;
      else if (title && (title.includes(expectedTitle) || expectedTitle.includes(title))) {
        score += 60;
      } else {
        score -= 5;
      }
    }

    const expectedAuthor = normalizeCompare(expected.author);
    const authors = this.normalizeAuthorNames(result.author_names);
    if (expectedAuthor) {
      if (authors.some((name) => normalizeCompare(name) === expectedAuthor)) {
        score += 40;
      } else if (authors.some((name) => normalizeCompare(name).includes(expectedAuthor))) {
        score += 20;
      } else {
        score -= 5;
      }
    }

    const isbns = this.normalizeIsbnArray(result.isbns);
    if (expected.isbn && isbns.includes(normalizeIsbn(expected.isbn))) {
      score += 30;
    }

    const usersCount = Number(result.users_count);
    if (Number.isFinite(usersCount)) {
      score += Math.min(usersCount / 100, 10);
    }

    return score;
  }

  pickBestBook(books, expected) {
    const expectedTitle = normalizeCompare(expected.title);
    const expectedAuthor = normalizeCompare(expected.author);

    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const book of books) {
      if (!book) continue;
      let score = 0;

      const title = normalizeCompare(book.title || '');
      if (expectedTitle) {
        if (title === expectedTitle) score += 100;
        else if (title && (title.includes(expectedTitle) || expectedTitle.includes(title))) {
          score += 60;
        } else {
          score -= 5;
        }
      }

      if (expectedAuthor) {
        const contributors = this.extractContributorNames(book);
        if (contributors.some((name) => normalizeCompare(name) === expectedAuthor)) {
          score += 40;
        } else if (contributors.some((name) => normalizeCompare(name).includes(expectedAuthor))) {
          score += 20;
        } else {
          score -= 5;
        }
      }

      const releaseYear = normalizeString(book.release_year || extractYear(book.release_date));
      if (expected.year && releaseYear && releaseYear === String(expected.year)) {
        score += 10;
      }

      if (score > bestScore) {
        bestScore = score;
        best = book;
      }
    }

    return best;
  }

  normalizeAuthorNames(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string') {
      const parsed = parseJsonMaybe(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
      return value.split(',').map((name) => name.trim()).filter(Boolean);
    }
    return [];
  }

  normalizeIsbnArray(value) {
    const items = coerceArray(value);
    return items.map((item) => normalizeIsbn(item)).filter(Boolean);
  }

  extractContributorNames(book) {
    const names = [];
    const contributions = Array.isArray(book?.contributions) ? book.contributions : [];
    for (const entry of contributions) {
      const name = normalizeString(entry?.author?.name);
      if (name) names.push(name);
    }

    if (!names.length && book?.cached_contributors) {
      const cached = parseJsonMaybe(book.cached_contributors);
      if (Array.isArray(cached)) {
        cached.forEach((entry) => {
          const name = normalizeString(entry?.name || entry?.author || entry?.author_name);
          if (name) names.push(name);
        });
      }
    }

    return names;
  }

  async fetchGraphQL(query, variables) {
    if (!this.isConfigured()) return null;

    const controller = AbortController ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;

    try {
      await this.limiter.acquire();
      const requestBody = JSON.stringify({ query, variables });
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': this.userAgent,
        authorization: this.token,
      };
      if (this.debug) {
        const logHeaders = { ...headers };
        if (!this.debugLogAuth && logHeaders.authorization) {
          logHeaders.authorization = `REDACTED(${String(logHeaders.authorization).length})`;
        }
        console.log('[HardcoverClient] request', {
          url: this.baseUrl,
          headers: logHeaders,
          body: requestBody,
        });
      }
      const response = await this.fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: requestBody,
        signal: controller ? controller.signal : undefined,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Hardcover request failed with ${response.status}: ${text.slice(0, 200)}`);
      }

      const payload = await response.json();
      if (payload?.errors?.length) {
        const message = payload.errors.map((err) => err?.message).filter(Boolean).join('; ');
        throw new Error(`Hardcover GraphQL error: ${message || 'Unknown error'}`);
      }

      return payload?.data || null;
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error('Hardcover request aborted');
      }
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

module.exports = { HardcoverClient };
