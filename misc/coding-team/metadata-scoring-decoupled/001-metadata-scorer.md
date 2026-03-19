# Task 001: MetadataScorer + metadataScoreConfig.json

## Context

`metadataScore.js` currently has a hardcoded `scoreBookCollectable()` function that only works for books. We need a generic, data-driven scoring engine that works for any media type, driven by a JSON config file.

The existing `scoreBookCollectable()` produces scores 0–100 with these weights:
- title: 15, creator: 20, publishers: 10, year: 10, description: 20 (full) / 10 (partial ≥40 chars), cover: 15, identifiers: 10 (ISBN/ASIN) / 5 (provider IDs), tags: 5

The new system must produce **identical scores** for books given the same input, so the CatalogRouter fallback behavior doesn't change.

## Objective

Create two files:
1. `api/config/metadataScoreConfig.json` — scoring criteria per media type
2. `api/services/catalog/MetadataScorer.js` — generic scoring engine

## Scope

### 1. `api/config/metadataScoreConfig.json`

```json
{
  "books": {
    "minScore": 55,
    "maxScore": 100,
    "fields": [
      { "field": "title", "check": "hasString", "weight": 15 },
      { "field": ["primaryCreator", "primaryAuthor", "author", "creators"], "check": "hasAny", "weight": 20 },
      { "field": ["publishers", "publisher", "publishersDetailed", "publisherDetailed"], "check": "hasAny", "weight": 10 },
      { "field": ["year", "publishYear", "releaseYear"], "check": "hasAny", "weight": 10 },
      { "field": "description", "check": "stringMinLength", "params": { "full": 120, "partial": 40, "partialWeight": 10 }, "weight": 20 },
      { "field": "coverImage", "check": "hasCoverImage", "weight": 15 },
      { "field": "identifiers", "check": "hasBookIdentifiers", "params": { "preferred": ["isbn13", "isbn10", "asin"], "fallback": ["openlibrary", "hardcover"], "fallbackWeight": 5 }, "weight": 10 },
      { "field": ["tags", "genre"], "check": "hasAny", "weight": 5 }
    ]
  },
  "vinyl": {
    "minScore": 45,
    "maxScore": 100,
    "fields": [
      { "field": "title", "check": "hasString", "weight": 20 },
      { "field": ["primaryCreator", "creators"], "check": "hasAny", "weight": 25 },
      { "field": ["year", "releaseYear"], "check": "hasAny", "weight": 10 },
      { "field": "coverImage", "check": "hasCoverImage", "weight": 15 },
      { "field": "identifiers", "check": "hasIdentifiers", "params": { "preferred": ["musicbrainz"] }, "weight": 10 },
      { "field": ["tags", "genre"], "check": "hasAny", "weight": 10 },
      { "field": "description", "check": "stringMinLength", "params": { "full": 40, "partial": 10, "partialWeight": 5 }, "weight": 10 }
    ]
  },
  "movies": {
    "minScore": 50,
    "maxScore": 100,
    "fields": [
      { "field": "title", "check": "hasString", "weight": 15 },
      { "field": ["primaryCreator", "creators"], "check": "hasAny", "weight": 15 },
      { "field": ["year", "releaseYear"], "check": "hasAny", "weight": 10 },
      { "field": "description", "check": "stringMinLength", "params": { "full": 120, "partial": 40, "partialWeight": 10 }, "weight": 20 },
      { "field": "coverImage", "check": "hasCoverImage", "weight": 15 },
      { "field": "identifiers", "check": "hasIdentifiers", "params": { "preferred": ["tmdb", "imdb"] }, "weight": 10 },
      { "field": ["tags", "genre"], "check": "hasAny", "weight": 5 },
      { "field": "runtime", "check": "hasValue", "weight": 5 },
      { "field": "extras.certification", "check": "hasNestedValue", "weight": 5 }
    ]
  },
  "games": {
    "minScore": 45,
    "maxScore": 100,
    "fields": [
      { "field": "title", "check": "hasString", "weight": 20 },
      { "field": ["primaryCreator", "creators"], "check": "hasAny", "weight": 10 },
      { "field": ["year", "releaseYear"], "check": "hasAny", "weight": 10 },
      { "field": "description", "check": "stringMinLength", "params": { "full": 80, "partial": 30, "partialWeight": 10 }, "weight": 20 },
      { "field": "coverImage", "check": "hasCoverImage", "weight": 15 },
      { "field": "identifiers", "check": "hasIdentifiers", "params": { "preferred": ["igdb"] }, "weight": 10 },
      { "field": ["tags", "genre"], "check": "hasAny", "weight": 5 },
      { "field": "systemName", "check": "hasString", "weight": 10 }
    ]
  },
  "tv": {
    "minScore": 50,
    "maxScore": 100,
    "fields": [
      { "field": "title", "check": "hasString", "weight": 15 },
      { "field": ["primaryCreator", "creators"], "check": "hasAny", "weight": 15 },
      { "field": ["year", "releaseYear"], "check": "hasAny", "weight": 10 },
      { "field": "description", "check": "stringMinLength", "params": { "full": 120, "partial": 40, "partialWeight": 10 }, "weight": 20 },
      { "field": "coverImage", "check": "hasCoverImage", "weight": 15 },
      { "field": "identifiers", "check": "hasIdentifiers", "params": { "preferred": ["tmdb"] }, "weight": 10 },
      { "field": ["tags", "genre"], "check": "hasAny", "weight": 5 },
      { "field": "extras.numberOfSeasons", "check": "hasNestedValue", "weight": 5 },
      { "field": "extras.status", "check": "hasNestedString", "weight": 5 }
    ]
  }
}
```

### 2. `api/services/catalog/MetadataScorer.js`

**Class `MetadataScorer`:**

Constructor: `constructor(options = {})` — accepts optional `configOverride` (a config object to use instead of the file). Loads config from `api/config/metadataScoreConfig.json` by default (read from disk via `fs.readFileSync` on construction, same pattern as other config files). Later tasks will add DB-backed override.

**Methods:**

- `score(collectable, containerType)` → `{ score, maxScore, missing, scoredAt }` 
  - Looks up `containerType` in config. If not found, returns `{ score: null, maxScore: null, missing: [], scoredAt }` (no opinion).
  - Iterates the `fields` array, evaluates each check, sums weights.
  - `missing` array contains the field name (first field if array) for each failed check.
  - `scoredAt` is an ISO timestamp string.

- `getMinScore(containerType)` → `number | null`
  - Returns the `minScore` for the container type, or `null` if not configured.

- `meetsThreshold(collectable, containerType)` → `boolean`
  - Shorthand: `score >= minScore`. Returns `true` if no config for the type (accept anything).

- `reloadConfig()` — re-reads the JSON file from disk.

**Check functions** (private methods or internal map):

- `hasString(collectable, field)` — `normalizeString(collectable[field])` is non-empty
- `hasValue(collectable, field)` — `collectable[field]` is not null/undefined/empty-string
- `hasNestedValue(collectable, field)` — supports dot notation like `extras.certification`. Resolves the nested path, checks non-null.
- `hasNestedString(collectable, field)` — like `hasNestedValue` but also checks `normalizeString()` is non-empty
- `hasAny(collectable, fields)` — `fields` is an array; returns true if ANY field passes `hasString` or `hasNonEmptyArray`
- `hasNonEmptyArray(collectable, field)` — value is an array with at least one non-empty string element
- `hasCoverImage(collectable, _field)` — checks `coverImageUrl`, `coverImage`, `coverUrl`, and `images` array (same logic as existing `hasCoverImage()` in metadataScore.js)
- `hasIdentifiers(collectable, _field, params)` — checks `collectable.identifiers` for any key in `params.preferred`. Returns full weight if found. No fallback weight concept (simpler than books).
- `hasBookIdentifiers(collectable, _field, params)` — book-specific: returns full weight for `preferred` keys (isbn13/isbn10/asin), `params.fallbackWeight` for `fallback` keys (openlibrary/hardcover). This preserves the exact book scoring behavior.
- `stringMinLength(collectable, field, params)` — checks `normalizeString(collectable[field]).length`. Returns full weight if `>= params.full`, `params.partialWeight` if `>= params.partial`, 0 otherwise. When partial weight is awarded, the field is NOT added to `missing`.

**Singleton:** `getMetadataScorer()` export, same pattern as other singletons.

**Backward compatibility:** `scoreBookCollectable(collectable)` must be preserved as a thin wrapper that calls `new MetadataScorer().score(collectable, 'books')` and returns `{ score, maxScore, missing }` (without `scoredAt`). The existing `metadataScore.js` file should re-export this wrapper so existing callers don't break.

## Non-goals

- No DB-backed config override yet (Task 005/006).
- No changes to CatalogRouter yet (Task 002).
- No changes to the upsert path yet (Task 003).

## Constraints

- CommonJS modules.
- The `books` config must produce identical scores to the existing `scoreBookCollectable()` for the same input. This is the critical backward-compat requirement.
- Config file is read from disk synchronously in the constructor (same pattern as `visionSettings.json`).
- `normalizeString()` and `hasCoverImage()` logic must be identical to the existing implementations in `metadataScore.js`.
