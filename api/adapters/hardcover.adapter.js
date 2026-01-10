const {
  makeCollectableFingerprint,
  makeLightweightFingerprint,
} = require('../services/collectables/fingerprint');

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeCompare(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
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

function extractYear(value) {
  if (!value) return null;
  const match = String(value).match(/\b(\d{4})\b/);
  return match ? match[1] : null;
}

function extractContributorNames(book, fallback = []) {
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

  if (!names.length && Array.isArray(fallback)) {
    fallback.forEach((entry) => {
      const name = normalizeString(entry);
      if (name) names.push(name);
    });
  }

  return uniqueStrings(names);
}

function extractPrimaryCreator(book, contributors) {
  const contributions = Array.isArray(book?.contributions) ? book.contributions : [];
  const authorContribution = contributions.find((entry) =>
    normalizeCompare(entry?.contribution) === 'author'
  );
  if (authorContribution?.author?.name) {
    return normalizeString(authorContribution.author.name);
  }
  return contributors[0] || null;
}

function extractTags(book, fallback = []) {
  const tags = [];
  const cached = parseJsonMaybe(book?.cached_tags);

  if (Array.isArray(cached)) {
    cached.forEach((entry) => {
      if (typeof entry === 'string') tags.push(entry);
      else if (entry?.tag) tags.push(entry.tag);
      else if (entry?.name) tags.push(entry.name);
    });
  } else if (cached && typeof cached === 'object') {
    Object.values(cached).forEach((value) => {
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (typeof entry === 'string') tags.push(entry);
          else if (entry?.name) tags.push(entry.name);
        });
      }
    });
  }

  if (Array.isArray(fallback)) {
    fallback.forEach((entry) => {
      if (typeof entry === 'string') tags.push(entry);
    });
  }

  return uniqueStrings(tags);
}

function extractImageVariants(value) {
  const parsed = parseJsonMaybe(value);
  if (!parsed) return null;
  if (typeof parsed === 'string') {
    return { urlSmall: parsed, urlMedium: parsed, urlLarge: parsed };
  }
  if (typeof parsed === 'object') {
    const urlLarge =
      parsed.url_large ||
      parsed.large ||
      parsed.full ||
      parsed.url ||
      parsed.src ||
      null;
    const urlMedium = parsed.url_medium || parsed.medium || urlLarge || null;
    const urlSmall = parsed.url_small || parsed.small || urlMedium || urlLarge || null;
    if (!urlSmall && !urlMedium && !urlLarge) return null;
    return { urlSmall, urlMedium, urlLarge };
  }
  return null;
}

function hardcoverToCollectable(enrichment, options = {}) {
  if (!enrichment?.book) return null;

  const book = enrichment.book;
  const edition = enrichment.edition || book.default_physical_edition || null;

  const rawSearchAuthors = enrichment?.search?.result?.author_names;
  const parsedSearchAuthors = parseJsonMaybe(rawSearchAuthors);
  const searchAuthors = Array.isArray(parsedSearchAuthors)
    ? parsedSearchAuthors
    : typeof rawSearchAuthors === 'string'
      ? rawSearchAuthors.split(',').map((name) => name.trim())
      : [];

  const contributors = extractContributorNames(book, searchAuthors);
  const primaryCreator = extractPrimaryCreator(book, contributors);

  const year =
    normalizeString(book.release_year) ||
    extractYear(book.release_date) ||
    extractYear(edition?.release_date) ||
    null;

  const publishers = uniqueStrings(
    edition?.publisher?.name ? [edition.publisher.name] : [],
  );

  const identifiers = {
    hardcover: {
      ...(book?.id != null ? { book: [String(book.id)] } : {}),
      ...(edition?.id != null ? { edition: [String(edition.id)] } : {}),
    },
  };

  if (edition?.isbn_13) identifiers.isbn13 = uniqueStrings([edition.isbn_13]);
  if (edition?.isbn_10) identifiers.isbn10 = uniqueStrings([edition.isbn_10]);
  if (edition?.asin) identifiers.asin = uniqueStrings([edition.asin]);

  const images = [];
  const coverVariants =
    extractImageVariants(edition?.cached_image) ||
    extractImageVariants(book?.cached_image);
  if (coverVariants) {
    images.push({
      kind: 'cover',
      urlSmall: coverVariants.urlSmall || coverVariants.urlMedium || coverVariants.urlLarge || null,
      urlMedium: coverVariants.urlMedium || coverVariants.urlLarge || coverVariants.urlSmall || null,
      urlLarge: coverVariants.urlLarge || coverVariants.urlMedium || coverVariants.urlSmall || null,
      provider: 'hardcover',
    });
  }

  const editions = [];
  if (edition) {
    const format =
      normalizeString(edition.physical_format) ||
      normalizeString(edition.edition_format) ||
      normalizeString(edition.reading_format?.format) ||
      null;

    editions.push({
      provider: 'hardcover',
      id: edition.id != null ? String(edition.id) : null,
      title: edition.title || book.title || null,
      subtitle: edition.subtitle || book.subtitle || null,
      labelOrPublisher: publishers,
      dateOrYear: edition.release_date || book.release_date || null,
      identifiers: new Map(Object.entries({
        isbn10: edition.isbn_10 ? [edition.isbn_10] : [],
        isbn13: edition.isbn_13 ? [edition.isbn_13] : [],
        asin: edition.asin ? [edition.asin] : [],
      })),
      physical: {
        format,
        pages: edition.pages || null,
        weight: null,
        dimensions: null,
        languages: edition.language?.language ? [edition.language.language] : [],
        extras: {},
      },
    });
  }

  const rawSearchTags = enrichment?.search?.result?.tags;
  const parsedSearchTags = parseJsonMaybe(rawSearchTags);
  const tags = extractTags(book, Array.isArray(parsedSearchTags) ? parsedSearchTags : []);

  const lwf =
    options.lightweightFingerprint ||
    makeLightweightFingerprint({ title: book.title, primaryCreator });

  const fingerprint = makeCollectableFingerprint({
    title: book.title,
    primaryCreator,
    releaseYear: year,
    mediaType: 'book',
    format: edition?.physical_format || edition?.edition_format,
  });

  const sourceUrls = {};
  if (book.slug) {
    sourceUrls.book = `https://hardcover.app/books/${book.slug}`;
  }

  const sources = [
    {
      provider: 'hardcover',
      ids: {
        ...(book?.id != null ? { book: String(book.id) } : {}),
        ...(edition?.id != null ? { edition: String(edition.id) } : {}),
      },
      urls: sourceUrls,
      fetchedAt: enrichment.fetchedAt || new Date(),
      raw: {
        searchScore: enrichment?.search?.score ?? null,
      },
    },
  ];

  return {
    kind: 'book',
    title: book.title || '',
    subtitle: book.subtitle || null,
    description: book.description || null,
    primaryCreator: primaryCreator || null,
    creators: contributors,
    publishers,
    year: year || null,
    tags,
    lightweightFingerprint: lwf || null,
    images,
    identifiers,
    physical: {
      format:
        normalizeString(edition?.physical_format) ||
        normalizeString(edition?.edition_format) ||
        null,
      pages: edition?.pages || null,
      weight: null,
      dimensions: null,
      languages: edition?.language?.language ? [edition.language.language] : [],
      extras: {},
    },
    editions,
    sources,
    fingerprint: fingerprint || null,
    extras: {},
  };
}

module.exports = { hardcoverToCollectable };
