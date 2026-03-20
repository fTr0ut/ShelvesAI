# Task 004: CoverArtBackfillHook Stub

## Context

The `MetadataScorer` now flags `coverImage` in the `missing` array when a collectable lacks cover art. The `AFTER_CATALOG_LOOKUP` hook fires with resolved results that include `_metadataMissing`. A future enhancement will use this hook point to attempt cover art backfill from alternate sources.

For now, we create a stub hook that detects missing cover art and logs it. No actual backfill logic.

## Objective

Create `api/services/catalog/CoverArtBackfillHook.js` — a stub hook handler that registers on `AFTER_CATALOG_LOOKUP` and logs when resolved items are missing cover art.

## Scope

**Single new file:** `api/services/catalog/CoverArtBackfillHook.js`

### Implementation

```js
class CoverArtBackfillHook {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.enabled = options.enabled ?? true;
  }

  /**
   * Register this hook with a VisionPipelineHooks instance.
   */
  register(hooks) {
    const { HOOK_TYPES } = require('../visionPipelineHooks');
    hooks.register(
      HOOK_TYPES.AFTER_CATALOG_LOOKUP,
      (context) => this.onAfterCatalogLookup(context),
      { name: 'CoverArtBackfillHook', priority: -10 } // low priority — runs after other hooks
    );
  }

  /**
   * Called after catalog lookup. Checks resolved items for missing cover art.
   */
  async onAfterCatalogLookup(context) {
    if (!this.enabled) return;
    const { resolved = [] } = context;

    const missingCover = resolved.filter((item) => {
      const missing = item?._metadataMissing || item?.enrichment?._metadataMissing || [];
      return missing.includes('coverImage');
    });

    if (missingCover.length > 0) {
      this.logger.log(
        `[CoverArtBackfillHook] ${missingCover.length} item(s) missing cover art`,
        missingCover.map((item) => item?.title || item?.input?.title || 'unknown').slice(0, 5),
      );
      // TODO: Implement cover art backfill from alternate sources
      // Potential sources per media type:
      //   - vinyl/album: Cover Art Archive retry, Discogs, Spotify
      //   - books: Open Library covers, Google Books
      //   - movies/tv: TMDB (already primary), OMDB
      //   - games: IGDB (already primary), SteamGridDB
    }
  }
}

module.exports = { CoverArtBackfillHook };
```

### Registration

Do NOT auto-register this hook anywhere yet. It's a stub. When the backfill logic is implemented, it will be registered in the pipeline setup (e.g., in `app.js` or wherever hooks are initialized). For now it's just an importable class.

## Non-goals

- No actual backfill logic.
- No registration in the pipeline.
- No tests needed (it's a stub with a TODO).

## Constraints

- CommonJS module.
- Low priority (-10) so it runs after other `AFTER_CATALOG_LOOKUP` hooks.
