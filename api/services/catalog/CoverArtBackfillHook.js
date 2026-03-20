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
