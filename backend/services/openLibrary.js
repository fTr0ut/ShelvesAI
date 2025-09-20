const fetch = require('node-fetch');
const AbortController = (globalThis && globalThis.AbortController) || fetch.AbortController || null;

const DEFAULT_BASE_URL = 'https://openlibrary.org';
const DEFAULT_TIMEOUT_MS = 4000;

function getBaseUrl() {
  return String(process.env.OPEN_LIBRARY_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function getTimeout() {
  const parsed = parseInt(process.env.OPEN_LIBRARY_TIMEOUT_MS || '', 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_TIMEOUT_MS;
}

function buildSearchUrl({ title, author }) {
  const base = getBaseUrl();
  const params = new URLSearchParams();
  if (title) params.append('title', title);
  if (author) params.append('author', author);
  params.append('limit', '10');
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
        'User-Agent': 'CollectorApp/1.0 (https://openlibrary.org/developers/api)',
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
  const primaryAuthor = Array.isArray(doc.author_name) ? doc.author_name[0] : null;
  const primaryPublisher = Array.isArray(doc.publisher) ? doc.publisher[0] : null;
  const publishYear = doc.first_publish_year || (Array.isArray(doc.publish_year) ? doc.publish_year[0] : null);
  const subtitle = doc.subtitle || null;
  const isbn = Array.isArray(doc.isbn) ? doc.isbn.find((code) => String(code).length === 13 || String(code).length === 10) : null;

  return {
    title: doc.title || null,
    subtitle,
    authors: Array.isArray(doc.author_name) ? doc.author_name.filter(Boolean) : [],
    publishers: Array.isArray(doc.publisher) ? doc.publisher.filter(Boolean) : [],
    publishYear: publishYear ? String(publishYear) : null,
    isbn: isbn || null,
    openLibraryId: doc.key || null,
    coverId: doc.cover_i || null,
    subjects: Array.isArray(doc.subject) ? doc.subject.slice(0, 10) : [],
  };
}

async function lookupWorkMetadata({ title, author }) {
  if (!title && !author) return null;
  try {
    const url = buildSearchUrl({ title, author });
    const json = await fetchJson(url);
    console.log('OpenLibrary JSON response', { title, author }, json);
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
    return normaliseDoc(best);
  } catch (err) {
    console.warn('OpenLibrary lookup failed', err.message);
    return null;
  }
}

module.exports = {
  lookupWorkMetadata,
};







