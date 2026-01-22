# Vision Pipeline Hooks

This document describes each hook exposed by the vision pipeline. Hook types are
defined in `api/services/visionPipelineHooks.js` and fired by
`api/services/visionPipeline.js`.

## Base Context
All hooks receive a base context with common fields:
- `jobId`: Vision job id when running async (nullable).
- `userId`: User id for the request.
- `shelfId`: Shelf id for the request.
- `shelfType`: Shelf type (book, movie, game, other, etc).
- `thresholds`: `{ max, min }` confidence thresholds.
- `ocrProvider`: `gemini` or `mlkit`.

Some hooks add more fields depending on the workflow step.

## Hooks

### afterVisionOCR
Fires after OCR extraction completes.
- Adds: `items`, `metadata` (`imageSize`, `source`).
- Use cases: logging, metrics, pre-filtering, QA sampling.

### afterConfidenceCategorization
Fires after items are split into confidence tiers.
- Adds: `highConfidence`, `mediumConfidence`, `lowConfidence`.
- Use cases: tier distribution metrics, sampling low-confidence items.

### afterFingerprintLookup
Fires after DB matching for a given tier.
- Adds: `tier` (`high` or `medium`), `matched`, `unmatched`.
- Use cases: match-rate tracking, per-tier diagnostics.

### afterCatalogLookup
Fires after catalog lookup for unmatched high-confidence items.
- Adds: `resolved`, `unresolved`, `skipped` (boolean).
- Use cases: catalog hit rates, API performance.

### afterGeminiEnrichment
Fires after Gemini enrichment.
- Adds: `enrichedItems`, `warnings`, `mode` (`standard`), `skipped` (boolean).
- Use cases: enrichment quality checks, warning aggregation.

### beforeCollectableSave
Fires before a collectable upsert.
- Adds: `payload` (collectable upsert data).
- Use cases: validation, custom enrichment, audit logging.

### beforeManualSave
Fires before a manual entry is saved.
- Adds: `payload` (manual add data), `tier` (when provided).
- Use cases: validation, manual data normalization.

### afterShelfUpsert
Fires after an item is added to the shelf.
- Adds: `shelfItem`, `collectable` or `manual`.
- Use cases: downstream triggers, analytics, audit events.

### afterNeedsReviewQueue
Fires after items are inserted into `needs_review`.
- Adds: `items`, `count`, `reason` (`low_confidence`, `missing_fields`,
  `post_enrichment`, `enrichment_disabled`).
- Use cases: review queue monitoring, alerting, sampling.
