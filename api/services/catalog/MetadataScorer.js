'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../config/metadataScoreConfig.json');

// ---------------------------------------------------------------------------
// Helpers (identical logic to metadataScore.js)
// ---------------------------------------------------------------------------

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function resolveNestedPath(obj, dotPath) {
  const parts = dotPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

// ---------------------------------------------------------------------------
// MetadataScorer
// ---------------------------------------------------------------------------

class MetadataScorer {
  /**
   * @param {object} [options]
   * @param {object} [options.configOverride] - Use this config object instead of reading from disk.
   */
  constructor(options = {}) {
    if (options.configOverride && typeof options.configOverride === 'object') {
      this._config = options.configOverride;
    } else {
      this._config = this._loadConfig();
    }
  }

  // -------------------------------------------------------------------------
  // Config loading
  // -------------------------------------------------------------------------

  _loadConfig() {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  }

  /**
   * Re-reads the JSON config file from disk.
   */
  reloadConfig() {
    this._config = this._loadConfig();
  }

  // -------------------------------------------------------------------------
  // Check functions
  // -------------------------------------------------------------------------

  /**
   * Returns true if collectable[field] is a non-empty string after normalization.
   */
  hasString(collectable, field) {
    return Boolean(normalizeString(collectable[field]));
  }

  /**
   * Returns true if collectable[field] is not null/undefined/empty-string.
   */
  hasValue(collectable, field) {
    const val = collectable[field];
    if (val == null) return false;
    if (val === '') return false;
    return true;
  }

  /**
   * Supports dot notation like "extras.certification".
   * Returns true if the resolved value is not null/undefined/empty-string.
   */
  hasNestedValue(collectable, field) {
    const val = resolveNestedPath(collectable, field);
    if (val == null) return false;
    if (val === '') return false;
    return true;
  }

  /**
   * Like hasNestedValue but also checks normalizeString() is non-empty.
   */
  hasNestedString(collectable, field) {
    const val = resolveNestedPath(collectable, field);
    return Boolean(normalizeString(val));
  }

  /**
   * Returns true if the value at collectable[field] is an array with at least
   * one non-empty string element.
   */
  hasNonEmptyArray(collectable, field) {
    const val = collectable[field];
    return Array.isArray(val) && val.some((entry) => normalizeString(entry));
  }

  /**
   * Returns true if ANY field in the fields array passes hasString OR hasNonEmptyArray.
   * fields is an array of field names.
   */
  hasAny(collectable, fields) {
    for (const field of fields) {
      if (this.hasString(collectable, field)) return true;
      if (this.hasNonEmptyArray(collectable, field)) return true;
    }
    return false;
  }

  /**
   * Checks coverImageUrl, coverImage, coverUrl, and images array.
   * Identical logic to hasCoverImage() in metadataScore.js.
   */
  hasCoverImage(collectable) {
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
   * Checks collectable.identifiers for any key in params.preferred.
   * Returns true if found (full weight). No fallback concept.
   */
  hasIdentifiers(collectable, _field, params) {
    const identifiers = collectable.identifiers || {};
    const preferred = (params && params.preferred) || [];
    for (const key of preferred) {
      if (this._hasIdentifierValues(identifiers[key])) return true;
    }
    return false;
  }

  /**
   * Book-specific identifier check.
   * Returns 'full' if preferred keys found, 'fallback' if fallback keys found, false otherwise.
   * Used internally by score() to award partial weight.
   */
  _hasBookIdentifiers(collectable, params) {
    const identifiers = collectable.identifiers || {};
    const preferred = (params && params.preferred) || [];
    const fallback = (params && params.fallback) || [];
    for (const key of preferred) {
      if (this._hasIdentifierValues(identifiers[key])) return 'full';
    }
    for (const key of fallback) {
      if (this._hasIdentifierValues(identifiers[key])) return 'fallback';
    }
    return false;
  }

  /**
   * Recursively checks if an identifier value is non-empty.
   * Identical logic to hasIdentifierValues() in metadataScore.js.
   */
  _hasIdentifierValues(value) {
    if (value == null) return false;
    if (Array.isArray(value)) return value.some((entry) => normalizeString(entry));
    if (typeof value === 'object') {
      return Object.values(value).some((entry) => this._hasIdentifierValues(entry));
    }
    return Boolean(normalizeString(value));
  }

  /**
   * Checks normalizeString(collectable[field]).length against thresholds.
   * Returns 'full', 'partial', or false.
   */
  _stringMinLengthResult(collectable, field, params) {
    const str = normalizeString(collectable[field]);
    if (str.length >= params.full) return 'full';
    if (str.length >= params.partial) return 'partial';
    return false;
  }

  // -------------------------------------------------------------------------
  // Core scoring
  // -------------------------------------------------------------------------

  /**
   * Score a collectable against the config for the given containerType.
   *
   * @param {object} collectable
   * @param {string} containerType - e.g. "books", "games", "movies"
   * @returns {{ score: number|null, maxScore: number|null, missing: string[], scoredAt: string }}
   */
  score(collectable, containerType) {
    const scoredAt = new Date().toISOString();
    const typeConfig = this._config[containerType];

    if (!typeConfig) {
      return { score: null, maxScore: null, missing: [], scoredAt };
    }

    const maxScore = typeConfig.maxScore != null ? typeConfig.maxScore : 100;
    const missing = [];
    let score = 0;

    for (const fieldDef of typeConfig.fields) {
      const { field, check, weight, params } = fieldDef;
      // field can be a string or an array
      const fieldName = Array.isArray(field) ? field[0] : field;

      let awarded = 0;
      let passed = false;

      switch (check) {
        case 'hasString':
          passed = this.hasString(collectable, field);
          if (passed) awarded = weight;
          break;

        case 'hasValue':
          passed = this.hasValue(collectable, field);
          if (passed) awarded = weight;
          break;

        case 'hasNestedValue':
          passed = this.hasNestedValue(collectable, field);
          if (passed) awarded = weight;
          break;

        case 'hasNestedString':
          passed = this.hasNestedString(collectable, field);
          if (passed) awarded = weight;
          break;

        case 'hasAny':
          passed = this.hasAny(collectable, field);
          if (passed) awarded = weight;
          break;

        case 'hasNonEmptyArray':
          passed = this.hasNonEmptyArray(collectable, field);
          if (passed) awarded = weight;
          break;

        case 'hasCoverImage':
          passed = this.hasCoverImage(collectable);
          if (passed) awarded = weight;
          break;

        case 'hasIdentifiers':
          passed = this.hasIdentifiers(collectable, field, params);
          if (passed) awarded = weight;
          break;

        case 'hasBookIdentifiers': {
          const result = this._hasBookIdentifiers(collectable, params);
          if (result === 'full') {
            awarded = weight;
            passed = true;
          } else if (result === 'fallback') {
            awarded = params.fallbackWeight || 0;
            passed = true; // partial credit — not missing
          }
          break;
        }

        case 'stringMinLength': {
          const result = this._stringMinLengthResult(collectable, field, params);
          if (result === 'full') {
            awarded = weight;
            passed = true;
          } else if (result === 'partial') {
            awarded = params.partialWeight || 0;
            passed = true; // partial credit — not missing
          }
          break;
        }

        default:
          // Unknown check — treat as not passed
          break;
      }

      score += awarded;
      if (!passed) {
        missing.push(fieldName);
      }
    }

    return { score, maxScore, missing, scoredAt };
  }

  /**
   * Returns the minScore for the container type, or null if not configured.
   * @param {string} containerType
   * @returns {number|null}
   */
  getMinScore(containerType) {
    const typeConfig = this._config[containerType];
    if (!typeConfig) return null;
    return typeConfig.minScore != null ? typeConfig.minScore : null;
  }

  /**
   * Returns true if the collectable's score meets the threshold for the type.
   * Returns true if no config exists for the type (accept anything).
   * @param {object} collectable
   * @param {string} containerType
   * @returns {boolean}
   */
  meetsThreshold(collectable, containerType) {
    const minScore = this.getMinScore(containerType);
    if (minScore == null) return true;
    const { score } = this.score(collectable, containerType);
    if (score == null) return true;
    return score >= minScore;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance = null;

function getMetadataScorer() {
  if (!_instance) {
    _instance = new MetadataScorer();
  }
  return _instance;
}

module.exports = { MetadataScorer, getMetadataScorer };
