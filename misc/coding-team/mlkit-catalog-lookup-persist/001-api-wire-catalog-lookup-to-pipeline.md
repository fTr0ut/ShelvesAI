# Task 001 — API: Wire processCatalogLookup to VisionPipelineService

## Context

`processCatalogLookup` in `api/controllers/shelvesController.js` (line ~1154) is the endpoint called by the mobile non-premium MLKit OCR path (`POST /api/shelves/:shelfId/catalog-lookup`). It currently enriches items via Gemini but **never persists anything** — it returns `results: []` and the existing shelf items unchanged. The premium path uses `VisionPipelineService.processImage()` which already supports a `rawItems` option that skips image OCR and runs the full resolve-and-persist pipeline.

## Objective

Replace the stub `processCatalogLookup` implementation so it feeds parsed items through the existing vision pipeline, resulting in items being added to the shelf and/or `needs_review` queue.

## Scope

**File:** `api/controllers/shelvesController.js` — function `processCatalogLookup` (line ~1154-1196)

Replace the current body with:

1. Load shelf (already done).
2. Validate `rawItems` (already done).
3. Normalize items into the shape the pipeline expects: each item needs at minimum `{ title, author, type/kind, confidence }`. The items from the mobile client have `{ name, author, type }`. Map `name` → `title`, set `kind` from `shelf.type`, and assign a default confidence of `1.0` (these are user-provided OCR items, treat as high confidence so they go through the full fingerprint → catalog → enrichment flow rather than straight to needs_review).
4. Instantiate `VisionPipelineService` (with hooks, same pattern as `processShelfVision` at line ~998).
5. Call `pipeline.processImage(null, shelf, userId, null, { rawItems: normalizedItems, ocrProvider: 'mlkit' })`. Pass `null` for `imageBase64` and `jobId` — the pipeline already handles `rawItems` mode and skips image OCR when `rawItems` is provided.
6. Return response matching what the mobile client will expect:
   ```json
   {
     "addedCount": result.addedItems?.length || 0,
     "needsReviewCount": result.needsReview?.length || 0,
     "analysis": result.analysis,
     "items": <hydrated shelf items via hydrateShelfItems>
   }
   ```

## Non-goals / Later

- No async job tracking / polling for this endpoint (pipeline runs fast with pre-parsed items).
- No quota check (this is the non-premium/fallback path).
- No premium gate (this endpoint is intentionally accessible to all authenticated users).
- Do not modify `VisionPipelineService` or any other file.

## Constraints / Caveats

- The existing Gemini `enrichShelfItems` call in the current implementation becomes redundant — the pipeline already does enrichment internally. Remove it.
- `processImage` with `rawItems` expects items to have a `title` field (not `name`). The mobile OCR parser (`parseTextToItems`) produces `{ name, author, type }`. The normalization in step 3 must map `name` → `title`.
- The `processImage` call with `null` imageBase64 and `rawItems` in options is an established pattern — see `processShelfVision` line ~1000-1001 where `pipelineOptions` is built the same way.
- Keep the existing 404/400 error handling for shelf-not-found and missing items.
