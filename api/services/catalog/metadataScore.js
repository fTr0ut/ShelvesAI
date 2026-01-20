const DEFAULT_BOOK_METADATA_MIN_SCORE = 55;

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeScoreThreshold(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, normalized));
}

function resolveBookMetadataMinScore({ options = {}, container = null, env = process.env } = {}) {
  const raw =
    options.bookMetadataMinScore ??
    options.minMetadataScore ??
    options.metadataMinScore ??
    container?.bookMetadataMinScore ??
    container?.minMetadataScore ??
    container?.minScore ??
    env.BOOK_METADATA_MIN_SCORE ??
    env.CATALOG_BOOK_MIN_SCORE;

  return normalizeScoreThreshold(raw, DEFAULT_BOOK_METADATA_MIN_SCORE);
}

function isBookContainer(containerType) {
  const normalized = normalizeString(containerType).toLowerCase();
  return normalized === 'book' || normalized === 'books';
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.some((entry) => normalizeString(entry));
}

function hasIdentifierValues(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some((entry) => normalizeString(entry));
  if (typeof value === 'object') {
    return Object.values(value).some((entry) => hasIdentifierValues(entry));
  }
  return Boolean(normalizeString(value));
}

function hasCoverImage(collectable) {
  if (!collectable || typeof collectable !== 'object') return false;
  const direct =
    normalizeString(collectable.coverImageUrl) ||
    normalizeString(collectable.coverImage) ||
    normalizeString(collectable.coverUrl);
  if (direct) return true;
  if (!Array.isArray(collectable.images)) return false;
  for (const image of collectable.images) {
    const url =
      normalizeString(image?.urlLarge) ||
      normalizeString(image?.urlMedium) ||
      normalizeString(image?.urlSmall) ||
      normalizeString(image?.url);
    if (url) return true;
  }
  return false;
}

function scoreBookCollectable(collectable) {
  const maxScore = 100;
  const missing = [];
  let score = 0;

  if (!collectable || typeof collectable !== 'object') {
    return { score: 0, maxScore, missing: ['collectable'] };
  }

  const title = normalizeString(collectable.title);
  if (title) score += 15;
  else missing.push('title');

  const primaryCreator =
    normalizeString(collectable.primaryCreator) ||
    normalizeString(collectable.primaryAuthor) ||
    normalizeString(collectable.author);
  const hasCreators = Boolean(primaryCreator) || hasNonEmptyArray(collectable.creators);
  if (hasCreators) score += 20;
  else missing.push('creator');

  const publishers =
    collectable.publishers ??
    collectable.publisher ??
    collectable.publishersDetailed ??
    collectable.publisherDetailed;
  const hasPublishers =
    hasNonEmptyArray(publishers) || Boolean(normalizeString(publishers));
  if (hasPublishers) score += 10;
  else missing.push('publishers');

  const year =
    normalizeString(collectable.year) ||
    normalizeString(collectable.publishYear) ||
    normalizeString(collectable.releaseYear);
  if (year) score += 10;
  else missing.push('year');

  const description = normalizeString(collectable.description);
  if (description.length >= 120) score += 20;
  else if (description.length >= 40) score += 10;
  else missing.push('description');

  if (hasCoverImage(collectable)) score += 15;
  else missing.push('cover');

  const identifiers = collectable.identifiers || {};
  const hasIsbn =
    hasIdentifierValues(identifiers.isbn13) ||
    hasIdentifierValues(identifiers.isbn10);
  const hasAsin = hasIdentifierValues(identifiers.asin);
  const hasProviderIds =
    hasIdentifierValues(identifiers.openlibrary) ||
    hasIdentifierValues(identifiers.hardcover);
  let identifierScore = 0;
  if (hasIsbn || hasAsin) identifierScore = 10;
  else if (hasProviderIds) identifierScore = 5;
  if (identifierScore) score += identifierScore;
  else missing.push('identifiers');

  const tags = collectable.tags ?? collectable.genre;
  if (hasNonEmptyArray(tags)) score += 5;
  else missing.push('tags');

  return { score, maxScore, missing };
}

module.exports = {
  scoreBookCollectable,
  resolveBookMetadataMinScore,
  isBookContainer,
};
