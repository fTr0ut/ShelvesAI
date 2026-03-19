const { MetadataScorer } = require('./MetadataScorer');

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

/**
 * Backward-compatible wrapper around MetadataScorer.
 * Delegates to the generic scoring engine for 'books' container type.
 */
function scoreBookCollectable(collectable) {
  if (!collectable || typeof collectable !== 'object') {
    return { score: 0, maxScore: 100, missing: ['collectable'] };
  }
  const scorer = new MetadataScorer();
  const { score, maxScore, missing } = scorer.score(collectable, 'books');
  return { score, maxScore, missing };
}

module.exports = {
  scoreBookCollectable,
  resolveBookMetadataMinScore,
  isBookContainer,
};
