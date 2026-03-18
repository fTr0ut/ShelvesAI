/**
 * String normalization utilities shared across the API.
 *
 * These functions were previously duplicated in:
 *   - api/controllers/shelvesController.js
 *   - api/routes/collectables.js
 *   - api/controllers/profileController.js
 */

/**
 * Trim and collapse internal whitespace.
 * Returns null for empty/null/undefined values.
 *
 * @param {*} value
 * @returns {string|null}
 */
function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/**
 * Accept one or more string/array arguments, flatten them into a single
 * deduplicated array of non-empty strings (case-insensitive dedup).
 *
 * @param {...(string|string[]|null|undefined)} values
 * @returns {string[]}
 */
function normalizeStringArray(...values) {
  const out = [];
  values.forEach((value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => out.push(entry));
    } else {
      out.push(value);
    }
  });
  const normalized = out.map((entry) => normalizeString(entry)).filter(Boolean);
  const seen = new Set();
  const deduped = [];
  for (const entry of normalized) {
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

/**
 * Parse a tag input (string or array) into a deduplicated lowercase-keyed
 * array of trimmed tag strings.
 *
 * Splits plain strings on whitespace or commas.
 *
 * @param {string|string[]|null|undefined} input
 * @returns {string[]}
 */
function normalizeTags(input) {
  if (input == null) return [];
  const source = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,]+/)
      : [];
  const seen = new Set();
  const tags = [];
  for (const entry of source) {
    const trimmed = String(entry ?? '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(trimmed);
  }
  return tags;
}

module.exports = { normalizeString, normalizeStringArray, normalizeTags };
