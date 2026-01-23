const { resolveShelfType } = require('../config/shelfTypeResolver');

/**
 * Normalize a collectable kind to its canonical form.
 * Uses shelfType.json as the source of truth via shelfTypeResolver.
 *
 * @param {string} value - Kind value to normalize
 * @param {string} fallback - Fallback value if input is null/empty
 * @returns {string} Canonical kind from shelfType.json (e.g., 'movies', 'books')
 */
function normalizeCollectableKind(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;

  // Use shelfTypeResolver which reads from shelfType.json
  const resolved = resolveShelfType(normalized);

  // If resolver returns 'other' but we had a non-empty input that wasn't 'other',
  // return the original normalized value to preserve unknown kinds
  if (resolved === 'other' && normalized !== 'other') {
    return normalized;
  }

  return resolved;
}

module.exports = {
  normalizeCollectableKind,
};
