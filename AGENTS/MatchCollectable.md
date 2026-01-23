# MatchCollectable Process

## Overview

The `matchCollectable` method in `VisionPipelineService` is responsible for matching items detected via OCR to existing collectables in the database. It uses a shelf-type-aware strategy to optimize matching based on what metadata is typically visible on item spines.

## Fingerprint Types

ShelvesAI uses several fingerprint types to identify and match items:

### Full Fingerprint
- **Format**: `{title}|{primaryCreator}|{year}|{mediaType}|{platforms}`
- **Used for**: Canonical identification of items from catalog APIs
- **Function**: `makeCollectableFingerprint()`
- **Stored in**: `collectables.fingerprint`

### Lightweight Fingerprint
- **Format**: MD5 hash of normalized `title + primaryCreator`
- **Used for**: Quick lookup without year/platform specificity
- **Function**: `makeLightweightFingerprint()`
- **Stored in**: `collectables.lightweight_fingerprint`

### Fuzzy Fingerprints Array
- **Format**: Array of MD5 hashes from raw OCR text
- **Used for**: Matching OCR-extracted text to previously enriched items
- **Function**: `makeVisionOcrFingerprint()`
- **Stored in**: `collectables.fuzzy_fingerprints` (JSONB array)

### Manual Fingerprint
- **Format**: `manual:{namespace}:{hash}` or `manual-other:{hash}`
- **Used for**: User-entered manual items
- **Function**: `makeManualFingerprint()`
- **Stored in**: `user_manuals.manual_fingerprint`

## Lookup Strategies by Shelf Type

Different media types have different metadata visibility on spines, so we use optimized lookup strategies:

### Books
**Strategy**: Lightweight fingerprint → Fuzzy fingerprint

| Step | Method | Rationale |
|------|--------|-----------|
| 1 | `findByLightweightFingerprint()` | Exact hash match |
| 2 | `findByFuzzyFingerprint()` | OCR hash in fuzzy_fingerprints array |

**Why**: Author names are typically visible on book spines, making creator-based fingerprints effective.

### Movies
**Strategy**: Lightweight fingerprint → Name search (trigram)

| Step | Method | Rationale |
|------|--------|-----------|
| 1 | `findByLightweightFingerprint()` | Exact hash match |
| 2 | `findByNameSearch()` | Trigram similarity on title only |

**Why**: Director names are rarely printed on Blu-ray/DVD spines. Title-only matching via PostgreSQL trigram similarity is more effective.

**Configuration**: `nameSearchThreshold: 0.4` in `visionSettings.json`

### TV
**Strategy**: Lightweight fingerprint → Name search (trigram)

| Step | Method | Rationale |
|------|--------|-----------|
| 1 | `findByLightweightFingerprint()` | Exact hash match |
| 2 | `findByNameSearch()` | Trigram similarity on title only |

**Why**: Same as movies - creator names rarely visible on TV show spines.

**Configuration**: `nameSearchThreshold: 0.4` in `visionSettings.json`

### Games
**Strategy**: Lightweight fingerprint → Fuzzy fingerprint

| Step | Method | Rationale |
|------|--------|-----------|
| 1 | `findByLightweightFingerprint()` | Exact hash match |
| 2 | `findByFuzzyFingerprint()` | OCR hash in fuzzy_fingerprints array |

**Why**: Publisher names are sometimes visible on game spines, similar to books.

## Query Methods Reference

### `findByFingerprint(fingerprint)`
- **Purpose**: Exact match on full fingerprint
- **Query**: `WHERE fingerprint = $1`
- **Returns**: Single collectable or null

### `findByLightweightFingerprint(lwf)`
- **Purpose**: Exact match on lightweight fingerprint hash
- **Query**: `WHERE lightweight_fingerprint = $1`
- **Returns**: Single collectable or null

### `findByFuzzyFingerprint(fuzzyFp)`
- **Purpose**: Check if hash exists in fuzzy_fingerprints array
- **Query**: `WHERE fuzzy_fingerprints @> $1::jsonb`
- **Returns**: Single collectable or null

### `findByNameSearch(title, kind, threshold)`
- **Purpose**: Trigram similarity search on title only
- **Query**: Uses `searchByTitle()` with limit 1, checks `sim >= threshold`
- **Returns**: Best matching collectable if above threshold, or null
- **Default threshold**: 0.4

### `searchByTitle(term, kind, limit)`
- **Purpose**: Trigram similarity search returning multiple results
- **Query**: `WHERE title % $1 ORDER BY similarity(title, $1) DESC`
- **Returns**: Array of collectables with `sim` score

## Trigram Matching

The name search functionality uses PostgreSQL's `pg_trgm` extension for fuzzy text matching.

### How It Works
1. Text is split into 3-character sequences (trigrams)
2. Similarity is calculated as: `(matching trigrams) / (total unique trigrams)`
3. The `%` operator returns true if similarity >= 0.3 (default)

### Thresholds
| Shelf Type | Threshold | Use Case |
|------------|-----------|----------|
| Movies | 0.4 | Title-only matching |
| TV | 0.4 | Title-only matching |
| Default | 0.3 | General fuzzy match |

### Example
```sql
-- Find movies similar to "The Matrix"
SELECT *, similarity(title, 'The Matrix') as sim
FROM collectables
WHERE title % 'The Matrix' AND kind = 'movies'
ORDER BY sim DESC LIMIT 1;
```

## Flow Diagram

```
                    ┌─────────────────────────┐
                    │   matchCollectable()     │
                    │   (item, shelfType)      │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │ 1. Check fingerprint    │
                    │    (if item has one)    │
                    └───────────┬─────────────┘
                                │
                         Found? ├────Yes────► Return collectable
                                │
                    ┌───────────▼─────────────┐
                    │ 2. Check lightweight    │
                    │    fingerprint (hash)   │
                    └───────────┬─────────────┘
                                │
                         Found? ├────Yes────► Return collectable
                                │
                    ┌───────────▼─────────────┐
                    │ 3. Shelf-type-specific  │
                    │    secondary lookup     │
                    └───────────┬─────────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
            ┌───────▼───────┐       ┌───────▼───────┐
            │  books/games  │       │  movies/tv    │
            │               │       │               │
            │ fuzzyFingerprint     │ nameSearch    │
            │ Lookup()      │       │ (trigram)     │
            └───────┬───────┘       └───────┬───────┘
                    │                       │
                    └───────────┬───────────┘
                                │
                         Found? ├────Yes────► Return collectable
                                │
                                ▼
                           Return null
                    (proceed to catalog lookup)
```

## Key Files

| File | Purpose |
|------|---------|
| `api/services/visionPipeline.js` | `matchCollectable()` entry point and helpers |
| `api/database/queries/collectables.js` | Database query methods |
| `api/services/collectables/fingerprint.js` | Fingerprint generation functions |
| `api/config/visionSettings.json` | Per-type thresholds and settings |
| `api/config/shelfType.json` | Shelf type definitions and aliases |

## Troubleshooting

### Item Not Matching When It Should

1. **Check fingerprint type being used**:
   - Enable debug logging: `[VisionPipeline.matchCollectable]` logs show which methods are tried
   - Verify the item has the expected fingerprint/creator data

2. **For movies/TV not matching**:
   - Check `nameSearchThreshold` in visionSettings.json
   - Try lowering threshold temporarily for testing
   - Verify the title in database vs OCR output

3. **For books/games not matching**:
   - Check if fuzzy fingerprint was stored during enrichment
   - Verify `rawOcrFingerprint` is being captured and saved

### False Positive Matches

1. **Trigram similarity too aggressive**:
   - Increase `nameSearchThreshold` in visionSettings.json
   - Consider adding kind filter if missing

2. **Wrong collectable matched**:
   - Check if multiple items have similar titles
   - The query returns the highest similarity match

### Performance Issues

1. **Slow trigram queries**:
   - Ensure `pg_trgm` GIN index exists on `collectables.title`
   - Check query plan with `EXPLAIN ANALYZE`

2. **Too many database calls**:
   - Each item makes 2-3 queries; batch operations not currently supported
   - Consider caching frequent lookups
