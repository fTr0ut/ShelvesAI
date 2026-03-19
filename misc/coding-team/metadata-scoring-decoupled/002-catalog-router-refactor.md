# Task 002: CatalogRouter Refactor — Universal Metadata Scoring

## Context

`CatalogRouter._lookupFallback()` currently gates scoring behind `isBookContainer()` (line 196). Only books get scored; all other media types accept the first non-null result. With `MetadataScorer` now available, we can score all media types and use the threshold to decide whether to try the next API.

## Objective

Refactor `CatalogRouter._lookupFallback()` to use `MetadataScorer` for all container types. Remove the book-only gate. Attach `_metadataScore` and `_metadataMissing` to all results.

## Scope

**Single file:** `api/services/catalog/CatalogRouter.js`

### Changes

1. **Replace imports** at the top of the file (around line 15-18):
   - Remove: `const { scoreBookCollectable, resolveBookMetadataMinScore, isBookContainer } = require('./metadataScore');`
   - Add: `const { MetadataScorer, getMetadataScorer } = require('./MetadataScorer');`

2. **Refactor `_lookupFallback()`** (around line 193-273):

   Current logic:
   ```js
   const shouldScore = isBookContainer(containerType);
   const minScore = shouldScore ? resolveBookMetadataMinScore({ options, container }) : null;
   ```

   New logic:
   ```js
   const scorer = getMetadataScorer();
   const minScore = scorer.getMinScore(containerType);
   const shouldScore = minScore !== null;
   ```

   Current scoring call:
   ```js
   const metadata = scoreBookCollectable(result);
   ```

   New scoring call:
   ```js
   const metadata = scorer.score(result, containerType);
   ```

   The rest of the fallback logic (threshold check, bestCandidate tracking, final return) stays the same. The `_metadataScore` and `_metadataMissing` fields are already attached to the wrapped result — this just makes them appear for all media types, not just books.

3. **Remove `resolveBookMetadataMinScore` usage** — The `MetadataScorer.getMinScore()` replaces it. The `resolveBookMetadataMinScore` function in `metadataScore.js` can stay for backward compat but is no longer called from CatalogRouter.

4. **Keep `_lookupMerge()` unchanged** — Merge mode doesn't score (it combines all results). No change needed.

## Non-goals

- No changes to `metadataScore.js` (it's already updated in Task 001).
- No changes to the merge mode.
- No changes to adapter loading or factory map.

## Constraints

- The `resolveBookMetadataMinScore` env-var override (`BOOK_METADATA_MIN_SCORE`, `CATALOG_BOOK_MIN_SCORE`) is being replaced by the config-driven `minScore` in `metadataScoreConfig.json`. This is intentional — the config file is the new source of truth. If env-var override is needed later, it can be added to `MetadataScorer.getMinScore()`.
- When `MetadataScorer` returns `score: null` (unknown container type), the router should accept any non-null result (same as current behavior for non-book types). The `shouldScore` flag handles this.

## Acceptance Criteria

- `npm run test:backend` passes.
- For books: behavior is identical (same threshold, same scoring, same fallback).
- For vinyl/movies/games/tv: results now get scored and `_metadataScore` / `_metadataMissing` are attached.
- For unknown container types: first non-null result is accepted (no scoring).
