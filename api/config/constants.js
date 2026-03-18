/**
 * Centralized API constants.
 *
 * Magic numbers that were previously scattered across multiple files are
 * collected here so they can be changed in one place and imported wherever
 * needed.
 *
 * Environment-variable overrides are resolved at startup so the rest of the
 * codebase can import plain numeric values.
 */

// ---------------------------------------------------------------------------
// Auth cache (api/middleware/auth.js)
// ---------------------------------------------------------------------------

const parsedAuthCacheTtl = parseInt(process.env.AUTH_CACHE_TTL_MS, 10);
/** How long (ms) an authenticated user record is cached in memory. */
const AUTH_CACHE_TTL_MS = Number.isFinite(parsedAuthCacheTtl) ? parsedAuthCacheTtl : 5000;

const parsedAuthCacheMax = parseInt(process.env.AUTH_CACHE_MAX, 10);
/** Maximum number of entries kept in the in-process auth cache (LRU eviction). */
const AUTH_CACHE_MAX_ENTRIES = Number.isFinite(parsedAuthCacheMax) ? parsedAuthCacheMax : 1000;

// ---------------------------------------------------------------------------
// Vision / OCR (api/controllers/shelvesController.js)
// ---------------------------------------------------------------------------

/** Default minimum OCR confidence score required to accept a vision result. */
const DEFAULT_OCR_CONFIDENCE_THRESHOLD = 0.7;

const parsedOcrThreshold = parseFloat(
  process.env.OPENAI_VISION_OCR_CONFIDENCE_THRESHOLD ||
  process.env.OPENAI_VISION_CONFIDENCE_THRESHOLD ||
  ''
);
/** Effective OCR confidence threshold (env-overridable). */
const OCR_CONFIDENCE_THRESHOLD = Number.isFinite(parsedOcrThreshold)
  ? Math.max(0, Math.min(1, parsedOcrThreshold))
  : DEFAULT_OCR_CONFIDENCE_THRESHOLD;

/** Default minimum AI-review confidence score. */
const DEFAULT_AI_REVIEW_CONFIDENCE_THRESHOLD = 0.35;

const parsedReviewThreshold = parseFloat(
  process.env.OPENAI_ENRICH_REVIEW_CONFIDENCE_THRESHOLD ||
  process.env.OPENAI_ENRICH_CONFIDENCE_THRESHOLD ||
  ''
);
/** Effective AI-review confidence threshold (env-overridable). */
const AI_REVIEW_CONFIDENCE_THRESHOLD = Number.isFinite(parsedReviewThreshold)
  ? Math.max(0, Math.min(1, parsedReviewThreshold))
  : DEFAULT_AI_REVIEW_CONFIDENCE_THRESHOLD;

// ---------------------------------------------------------------------------
// Feed aggregation (api/database/queries/feed.js)
// ---------------------------------------------------------------------------

const parsedAggregateWindow = parseInt(process.env.FEED_AGGREGATE_WINDOW_MINUTES, 10);
/** Minutes within which feed events are merged into a single aggregate. */
const AGGREGATE_WINDOW_MINUTES = Number.isFinite(parsedAggregateWindow) ? parsedAggregateWindow : 15;

const parsedPreviewLimit = parseInt(process.env.FEED_AGGREGATE_PREVIEW_LIMIT, 10);
/** Maximum number of payload items included in a feed aggregate preview. */
const PREVIEW_PAYLOAD_LIMIT = Number.isFinite(parsedPreviewLimit) ? parsedPreviewLimit : 5;

// ---------------------------------------------------------------------------
// Pagination defaults (api/database/queries/utils.js)
// ---------------------------------------------------------------------------

/** Default page size used by parsePagination when no limit is supplied. */
const DEFAULT_PAGE_LIMIT = 20;

/** Hard upper bound on page size accepted by parsePagination. */
const MAX_PAGE_LIMIT = 100;

module.exports = {
  AUTH_CACHE_TTL_MS,
  AUTH_CACHE_MAX_ENTRIES,
  DEFAULT_OCR_CONFIDENCE_THRESHOLD,
  OCR_CONFIDENCE_THRESHOLD,
  DEFAULT_AI_REVIEW_CONFIDENCE_THRESHOLD,
  AI_REVIEW_CONFIDENCE_THRESHOLD,
  AGGREGATE_WINDOW_MINUTES,
  PREVIEW_PAYLOAD_LIMIT,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
};
