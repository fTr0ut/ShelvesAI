// openLibrary.js
// Enhances search results by hydrating each result from Work/Edition/Author .json endpoints.
//
// Docs:
// - "Nearly every page … add .json/.rdf/.yml" https://openlibrary.org/developers/api
// - Search API: https://openlibrary.org/dev/docs/api/search
// - RESTful formats (.json via URL or Accept header): https://openlibrary.org/dev/docs/restful_api
// - Covers API patterns: https://openlibrary.org/dev/docs/api/covers

const fetch = require('node-fetch');
const AbortController = (globalThis && globalThis.AbortController) || fetch.AbortController || null;

const DEFAULT_BASE_URL = 'https://openlibrary.org';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CONCURRENCY = 3;

function getBaseUrl() {
  return String(process.env.OPEN_LIBRARY_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function getTimeout() {
  const parsed = parseInt(process.env.OPEN_LIBRARY_TIMEOUT_MS || '', 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_TIMEOUT_MS;
}

function getConcurrency() {
  const parsed = parseInt(process.env.OPEN_LIBRARY_CONCURRENCY || '', 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_CONCURRENCY;
}

function normalizeAuthorQuery(author) {
  if (!author) return author;

  let normalized = String(author);

  normalized = normalized.replace(/([A-Za-z])\.([A-Za-z])/g, '$1. $2');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

function buildSearchUrl({ title, author, limit = 10 }) {
  const base = getBaseUrl();
  const params = new URLSearchParams();
  if (title) params.append('title', title);
  if (author) {
    const normalizedAuthor = normalizeAuthorQuery(author);
    if (normalizedAuthor !== author) {
      console.log('[openLibrary.buildSearchUrl] normalized author', { original: author, normalized: normalizedAuthor });
    }
    params.append('author', normalizedAuthor);
  }
  params.append('limit', String(limit));
  // `mode=everything` returns broader info (works + editions metadata surface)
  params.append('mode', 'everything');
  return `${base}/search.json?${params.toString()}`;
}

async function fetchJson(url) {
  const controller = AbortController ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), getTimeout()) : null;
  try {
    const response = await fetch(url, {
      signal: controller ? controller.signal : undefined,
      headers: {
        'User-Agent': 'CollectorApp/1.0 (johnandrewnichols@gmail.com)',
      },
    });
    if (!response.ok) {
      throw new Error(`OpenLibrary request failed with ${response.status}`);
    }
    return await response.json();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// --- Helpers ---------------------------------------------------------------

function isUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

function asText(maybe) {
  if (!maybe) return null;
  if (typeof maybe === 'string') return maybe;
  if (typeof maybe === 'object') {
    if (typeof maybe.value === 'string') return maybe.value;
    if (typeof maybe.description === 'string') return maybe.description;
    if (maybe.value && typeof maybe.value === 'object' && typeof maybe.value.value === 'string') {
      return maybe.value.value;
    }
  }
  return null;
}

function extractIdFromKey(key) {
  // "/works/OL12345W" -> "OL12345W"
  if (!key) return null;
  const parts = String(key).split('/');
  return parts[parts.length - 1] || null;
}

function makePathFromIdentifier(identifier) {
  if (!identifier) return null;
  if (identifier.startsWith('/')) return identifier;
  // Raw IDs => infer type by suffix
  if (/^OL\d+[WMA]$/i.test(identifier)) {
    const last = identifier.slice(-1).toUpperCase();
    if (last === 'W') return `/works/${identifier}`;
    if (last === 'M') return `/books/${identifier}`;   // edition
    if (last === 'A') return `/authors/${identifier}`;
  }
  // Already like "works/OL..." or "authors/OL..."
  if (/^(works|books|authors)\//i.test(identifier)) return `/${identifier}`;
  return `/${identifier}`;
}

function jsonUrlFor(identifierOrPathOrUrl) {
  const base = getBaseUrl();
  if (isUrl(identifierOrPathOrUrl)) {
    return identifierOrPathOrUrl.endsWith('.json')
      ? identifierOrPathOrUrl
      : `${identifierOrPathOrUrl}.json`;
  }
  const path = makePathFromIdentifier(identifierOrPathOrUrl);
  return `${base}${path}.json`;
}

function coverUrlFromId(coverId, size = 'L') {
  if (!coverId) return null;
  // https://covers.openlibrary.org/b/id/<coverId>-L.jpg
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
}

function scoreDoc(doc, { title, author }) {
  let score = 0;
  if (!doc) return score;
  if (doc.edition_count) score += doc.edition_count;
  if (doc.has_fulltext) score += 5;
  if (title && doc.title) {
    const titleLower = title.toLowerCase();
    const docTitle = String(doc.title).toLowerCase();
    if (docTitle === titleLower) score += 10;
    else if (docTitle.includes(titleLower)) score += 6;
  }
  if (author && Array.isArray(doc.author_name)) {
    const authorLower = author.toLowerCase();
    if (doc.author_name.some((name) => String(name).toLowerCase() === authorLower)) score += 8;
  }
  if (Array.isArray(doc.isbn) && doc.isbn.length) score += 2;
  return score;
}

function normaliseDoc(doc) {
  if (!doc) return null;
  const publishYear = doc.first_publish_year || (Array.isArray(doc.publish_year) ? doc.publish_year[0] : null);
  const subtitle = doc.subtitle || null;
  const isbn =
    Array.isArray(doc.isbn) ? doc.isbn.find((code) => String(code).length === 13 || String(code).length === 10) : null;

  return {
    title: doc.title || null,
    subtitle,
    authors: Array.isArray(doc.author_name) ? doc.author_name.filter(Boolean) : [],
    publishers: Array.isArray(doc.publisher) ? doc.publisher.filter(Boolean) : [],
    publishYear: publishYear ? String(publishYear) : null,
    isbn: isbn || null,
    openLibraryId: doc.key || null, // NOTE: this is the Work key (e.g., "/works/OL...W")
    coverId: doc.cover_i || null,
    subjects: Array.isArray(doc.subject) ? doc.subject.slice(0, 10) : [],
  };
}

// Concurrency helper
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    (async function worker() {
      for (;;) {
        const i = index++;
        if (i >= items.length) break;
        try {
          results[i] = await mapper(items[i], i);
        } catch (e) {
          results[i] = null;
        }
      }
    })()
  );
  await Promise.all(workers);
  return results;
}

// --- Hydration (Work -> Authors + Edition) ----------------------------------

async function fetchWorkJson(workKeyOrId) {
  const url = jsonUrlFor(workKeyOrId);
  return fetchJson(url);
}

async function fetchAuthorJson(authorKeyOrId) {
  const url = jsonUrlFor(authorKeyOrId);
  return fetchJson(url);
}

async function fetchEditionJson(editionKeyOrId) {
  // NOTE: edition IDs end with M and live under /books/<OL...M>.json
  const key = String(editionKeyOrId);
  const path = key.startsWith('/books/') ? key : (/^OL\d+M$/i.test(key) ? `/books/${key}` : key);
  const url = jsonUrlFor(path);
  return fetchJson(url);
}

function pickEditionKey(doc) {
  // Heuristic: prefer first edition; if present, prefer one with cover or isbn in the doc's arrays
  if (!Array.isArray(doc?.edition_key) || doc.edition_key.length === 0) return null;
  return doc.edition_key[0];
}

async function hydrateDoc(doc) {
  if (!doc) return null;

  const workKey = doc.key; // e.g. "/works/OL1892617W"
  let work = null;
  try {
    work = await fetchWorkJson(workKey);
  } catch (e) {
    // Fallback: at least return the normalized search doc
    return {
      ...normaliseDoc(doc),
      workKey,
      workId: extractIdFromKey(workKey),
      hydrationError: e.message,
    };
  }

  // Authors (from Work JSON)
  const authorRefs = Array.isArray(work?.authors) ? work.authors : [];
  const authorKeys = authorRefs
    .map((a) => (a && a.author && a.author.key ? a.author.key : a?.key))
    .filter(Boolean)
    .slice(0, 5); // be reasonable

  const authors = await mapWithConcurrency(
    authorKeys,
    Math.max(1, Math.min(getConcurrency(), 3)),
    async (aKey) => {
      try {
        const a = await fetchAuthorJson(aKey);
        return {
          name: a?.name || null,
          key: a?.key || aKey,
          id: extractIdFromKey(a?.key || aKey),
          bio: asText(a?.bio),
          links: Array.isArray(a?.links)
            ? a.links
                .map((l) => ({ title: l?.title || null, url: l?.url || null }))
                .filter((x) => x.url)
            : [],
        };
      } catch {
        return { name: null, key: aKey, id: extractIdFromKey(aKey) };
      }
    }
  );

  // Representative Edition
  const chosenEditionKey = pickEditionKey(doc);
  let edition = null;
  if (chosenEditionKey) {
    try {
      const ej = await fetchEditionJson(chosenEditionKey);
      edition = {
        key: ej?.key || `/books/${chosenEditionKey}`,
        id: extractIdFromKey(ej?.key || `/books/${chosenEditionKey}`),
        title: ej?.title || null,
        subtitle: ej?.subtitle || null,
        number_of_pages: ej?.number_of_pages || null,
        pagination: ej?.pagination || null,
        publish_date: ej?.publish_date || null,
        publishers: Array.isArray(ej?.publishers) ? ej.publishers : Array.isArray(doc.publisher) ? doc.publisher : [],
        isbn_10: Array.isArray(ej?.isbn_10) ? ej.isbn_10 : null,
        isbn_13: Array.isArray(ej?.isbn_13) ? ej.isbn_13 : null,
        physical_format: ej?.physical_format || null,
        weight: ej?.weight || null,
        languages: Array.isArray(ej?.languages)
          ? ej.languages.map((l) => extractIdFromKey(l?.key)).filter(Boolean)
          : null,
      };
    } catch {
      // ignore
    }
  }

  // Work-level fields
  const description = asText(work?.description);
  const workCoverIds = Array.isArray(work?.covers) ? work.covers : (doc.cover_i ? [doc.cover_i] : []);
  const subjects =
    Array.isArray(work?.subjects) && work.subjects.length ? work.subjects
      : Array.isArray(doc?.subject) ? doc.subject.slice(0, 25)
      : [];

  const normal = normaliseDoc(doc);

  return {
    ...normal,
    // Canonical source of truth
    title: work?.title || normal.title,
    subtitle: work?.subtitle || normal.subtitle,
    workKey,
    workId: extractIdFromKey(workKey),
    description,
    subjects,
    // Authors upgraded with bios/links when available
    authorsDetailed: authors,
    // Covers
    coverIds: workCoverIds,
    coverUrls: {
      large: workCoverIds[0] ? coverUrlFromId(workCoverIds[0], 'L') : null,
      medium: workCoverIds[0] ? coverUrlFromId(workCoverIds[0], 'M') : null,
      small: workCoverIds[0] ? coverUrlFromId(workCoverIds[0], 'S') : null,
    },
    // Edition details
    edition,
    // Helpful direct links
    openLibraryUrls: {
      work: `${getBaseUrl()}${workKey}`,
      workJson: jsonUrlFor(workKey),
      edition: edition?.key ? `${getBaseUrl()}${edition.key}` : null,
      editionJson: edition?.key ? jsonUrlFor(edition.key) : null,
    },
  };
}

// --- Public API -------------------------------------------------------------

/**
 * High-level: search, then hydrate each result by visiting Work/Edition/Author .json pages.
 * @param {{title?: string, author?: string, limit?: number}} params
 * @returns {Promise<Array<object>>}
 */
async function searchAndHydrateBooks({ title, author, limit = 5 } = {}) {
  if (!title && !author) return [];
  try {
    const url = buildSearchUrl({ title, author, limit: 10 }); // get >limit so we can score & slice
    console.log('[openLibrary.searchAndHydrateBooks] request', { title, author, fetchLimit: 10, clientLimit: limit, url });
    const json = await fetchJson(url);
    const docs = Array.isArray(json?.docs) ? json.docs : [];
    if (!docs.length) return [];

    // Score + pick best `limit`
    const scored = docs.map((d) => ({ d, s: scoreDoc(d, { title, author }) }));
    scored.sort((a, b) => b.s - a.s);
    const selected = scored.slice(0, Math.max(1, limit)).map((x) => x.d);

    // Hydrate with controlled concurrency
    const hydrated = await mapWithConcurrency(selected, getConcurrency(), hydrateDoc);
    return hydrated.filter(Boolean);
  } catch (err) {
    console.warn('OpenLibrary searchAndHydrateBooks failed', err.message);
    return [];
  }
}

/**
 * Backwards-compatible single best match (returns your original shape + extras when available).
 * @param {{title?: string, author?: string}} params
 * @returns {Promise<object|null>}
 */
async function lookupWorkBookMetadata({ title, author }) {
  if (!title && !author) return null;
  try {
    const url = buildSearchUrl({ title, author });
    console.log('[openLibrary.lookupWorkBookMetadata] request', { title, author, url });
    const json = await fetchJson(url);
    const docs = Array.isArray(json?.docs) ? json.docs : [];
    if (!docs.length) return null;

    let best = null;
    let bestScore = -Infinity;
    for (const doc of docs) {
      const score = scoreDoc(doc, { title, author });
      if (score > bestScore) {
        best = doc;
        bestScore = score;
      }
    }
    // NEW: hydrate the best match for richer fields while preserving original shape
    return await hydrateDoc(best);
  } catch (err) {
    console.warn('OpenLibrary lookup failed', err.message);
    return null;
  }
}

/**
 * Direct hydration by Work key or ID (e.g., "/works/OL1892617W" or "OL1892617W").
 * Useful when you already know the Work ID.
 */
async function hydrateWorkByKey(workKeyOrId) {
  try {
    // Get minimal doc-like object so `hydrateDoc` can reuse normalization.
    const work = await fetchWorkJson(workKeyOrId);
    const workKey =
      work?.key || (typeof workKeyOrId === 'string' && workKeyOrId.startsWith('/') ? workKeyOrId : `/works/${workKeyOrId}`);
    // Synthesize a minimal "doc" compatible with hydrateDoc (for fallbacks)
    const fakeDoc = {
      key: workKey,
      title: work?.title,
      subtitle: work?.subtitle,
      cover_i: Array.isArray(work?.covers) ? work.covers[0] : null,
      author_name: Array.isArray(work?.authors) ? work.authors.map((a) => a?.name).filter(Boolean) : [],
      publisher: [],
      subject: Array.isArray(work?.subjects) ? work.subjects : [],
      edition_key: [],
    };
    return await hydrateDoc(fakeDoc);
  } catch (e) {
    console.warn('OpenLibrary hydrateWorkByKey failed', e.message);
    return null;
  }
}
// ---- Canonical Collection Schema + Mapper ----------------------------------
// A single, reusable "Collection" document you can store once in Mongo
// and reference from any user shelf. Designed for Works + a representative Edition.

function pickPrimaryAuthorName(h) {
  if (Array.isArray(h.authorsDetailed) && h.authorsDetailed.length) {
    return h.authorsDetailed[0]?.name || null;
  }
  if (Array.isArray(h.authors) && h.authors.length) {
    return h.authors[0] || null;
  }
  return null;
}

function uniqueStrings(arr) {
  return Array.from(new Set((arr || []).filter(Boolean))).slice(0, 25);
}

/**
 * Create a deterministic fingerprint for deduping across multiple sources.
 * This helps when the same book appears via different providers.
 * Ex: sha1("title|author|year")
 */
const crypto = require('crypto');
function makeFingerprint({ title, primaryAuthor, publishYear }) {
  const base = [
    (title || '').trim().toLowerCase(),
    (primaryAuthor || '').trim().toLowerCase(),
    (publishYear || '').trim(),
  ].join('|');
  return crypto.createHash('sha1').update(base).digest('hex');
}

/**
 * Turn a hydrated Open Library object into a canonical "Collection" doc.
 * Input: one element from searchAndHydrateBooks() or lookupWorkBookMetadata()
 */
function toCollectionDoc(h) {
  if (!h || !h.workId) return null;

  const primaryAuthor = pickPrimaryAuthorName(h);
  const publishers = h.edition?.publishers?.length ? h.edition.publishers
                    : (Array.isArray(h.publishers) ? h.publishers : []);
  const publishYear = h.publishYear
    || (h.edition?.publish_date ? String(h.edition.publish_date).match(/\b(\d{4})\b/)?.[1] : null);

  const identifiers = {
    openlibrary: {
      work: h.workId || null,
      edition: h.edition?.id || null,
    },
    isbn10: Array.isArray(h.edition?.isbn_10) ? uniqueStrings(h.edition.isbn_10) : [],
    isbn13: Array.isArray(h.edition?.isbn_13) ? uniqueStrings(h.edition.isbn_13) : [],
    // Leave room for other providers later (google, isfdb, etc.)
  };

  const cover = {
    id: Array.isArray(h.coverIds) && h.coverIds.length ? h.coverIds[0] : h.coverId || null,
    urls: {
      small: h.coverUrls?.small || null,
      medium: h.coverUrls?.medium || null,
      large: h.coverUrls?.large || null,
    }
  };

  const physical = {
    format: h.edition?.physical_format || null,
    pages: h.edition?.number_of_pages || null,
    weight: h.edition?.weight || null,
    dimensions: null, // Open Library sometimes has this as a freeform string; add later if you parse it
    languages: Array.isArray(h.edition?.languages) ? uniqueStrings(h.edition.languages) : [],
  };

  const out = {
    // Stable refs
    workId: h.workId,                     // "OL1892617W"
    editionId: h.edition?.id || null,     // e.g., "OL12345M"
    fingerprint: makeFingerprint({ title: h.title, primaryAuthor, publishYear }),

    // Canonical bibliographic fields
    title: h.title || null,
    subtitle: h.subtitle || null,
    description: h.description || null,

    primaryAuthor,
    authors: uniqueStrings(
      (h.authorsDetailed || []).map(a => a?.name).filter(Boolean).length
        ? (h.authorsDetailed || []).map(a => a?.name).filter(Boolean)
        : (h.authors || [])
    ),

    publishers: uniqueStrings(publishers),
    publishYear: publishYear || null,

    subjects: uniqueStrings(h.subjects || []),

    cover,

    physical,

    identifiers,

    // Source + links
    source: {
      provider: 'openlibrary',
      workUrl: h.openLibraryUrls?.work || null,
      workJson: h.openLibraryUrls?.workJson || null,
      editionUrl: h.openLibraryUrls?.edition || null,
      editionJson: h.openLibraryUrls?.editionJson || null,
      fetchedAt: new Date().toISOString(),
    },

    // Free area to attach enrichment later (e.g., ratings, summaries)
    extras: {},

    // housekeeping
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return out;
}



async function lookupWorkByISBN(isbn) {
  const code = (isbn || '').trim();
  if (!code) return null;

  const base = getBaseUrl();
  try {
    const edition = await fetchJson(`${base}/isbn/${encodeURIComponent(code)}.json`);
    const workKey = Array.isArray(edition?.works) && edition.works.length ? edition.works[0]?.key : null;
    if (!workKey) return null;
    const hydrated = await hydrateWorkByKey(workKey);
    return hydrated ? toCollectionDoc(hydrated) : null;
  } catch (err) {
    if (String(err?.message).includes('404')) return null;
    throw err;
  }
}

module.exports = {
  // New, rich, multi-result API
  searchAndHydrateBooks,
  // Back-compat (now hydrated)
  lookupWorkBookMetadata,
  lookupWorkByISBN,
  // Direct helper
  hydrateWorkByKey,
  // Canonical Collection doc mapper
  toCollectionDoc,
};
