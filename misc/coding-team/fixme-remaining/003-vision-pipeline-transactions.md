# 003 — Vision Pipeline Transaction Safety

## Context

BUG-9: The vision pipeline (`api/services/visionPipeline.js`, ~1,427 lines) performs multiple sequential DB operations without transactions. If a step fails mid-way, previous writes persist as orphaned records.

Operations at risk:
- `saveToShelf()` calls `collectablesQueries.upsert()` then `shelvesQueries.addCollectable()` per item
- `saveManualToShelf()` calls `shelvesQueries.addManual()` per item
- `saveToReviewQueue()` calls `needsReviewQueries.create()` per item
- Feed event logging via `feedQueries.logEvent()`

## Objective

Wrap the multi-step save operations in database transactions so partial failures roll back cleanly.

## Scope

- `api/services/visionPipeline.js` — the `saveToShelf()`, `saveManualToShelf()`, and `saveToReviewQueue()` methods
- `api/database/pg.js` — `transaction(fn)` is already available and passes a `client` to the callback

## Non-goals

- Do not refactor the entire pipeline architecture.
- Do not wrap the full pipeline (OCR + matching + enrichment + save) in a single transaction — only the save phase needs atomicity.
- Do not change the feed event logging to be transactional — it's fire-and-forget by design and has its own error handling.

## Constraints

- The `transaction(fn)` helper in `pg.js` provides `client` to the callback. The query modules currently use the shared `query()` function, not a client. You'll need to either:
  - Pass `client` through to the query functions (preferred if they accept it), or
  - Call `client.query()` directly in the pipeline for the transactional operations
- Check whether `shelvesQueries.addCollectable`, `shelvesQueries.addManual`, `collectablesQueries.upsert`, and `needsReviewQueries.create` accept a `client` parameter. If not, add optional `client` support to those functions (pattern: `async function foo(params, client = null) { const q = client ? client.query.bind(client) : query; ... }`).
- The global test mock in `setup.js` already mocks `transaction`. Verify existing tests still pass.
