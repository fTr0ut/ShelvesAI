# Task 001: MusicBrainz Request Queue

## Context

MusicBrainz enforces a strict rate limit of **1 request per second** per client. The existing `utils/RateLimiter.js` is a sliding-window token bucket (N requests per window) — it doesn't enforce sequential spacing between requests. For MusicBrainz we need a FIFO queue that guarantees >= 1000ms between the *completion* of one request and the *start* of the next.

During vision pipeline batch lookups (`lookupFirstPass`), 10+ items may queue up simultaneously. The queue must serialize these correctly.

## Objective

Create `api/services/catalog/MusicBrainzRequestQueue.js` — a FIFO request queue with minimum inter-request interval enforcement.

## Scope

Single new file: `api/services/catalog/MusicBrainzRequestQueue.js`

## Requirements

- **Class `MusicBrainzRequestQueue`** with:
  - Constructor accepts `{ minIntervalMs = 1000, delayFn = (ms) => new Promise(r => setTimeout(r, ms)) }` for testability.
  - `enqueue(fn)` — accepts an async function `fn`, returns a Promise that resolves/rejects with `fn`'s result. Requests execute FIFO. Each `fn()` starts no sooner than `minIntervalMs` after the previous `fn()` *started* (wall-clock spacing, not completion-based — this prevents slow responses from creating unnecessary extra gaps).
  - Tracks `_lastRequestTime` to compute required delay before next request.
  - If the queue is idle and enough time has passed since the last request, `fn()` executes immediately (no unnecessary delay).
  - Errors from `fn()` propagate to the caller; the queue continues processing the next item regardless.

- **Singleton** via `getRequestQueue()` export (same pattern as `getCatalogRouter()` in this codebase).

- **Module exports:** `{ MusicBrainzRequestQueue, getRequestQueue }`

## Non-goals

- No retry logic (that's the catalog service's job).
- No priority lanes.
- No cancellation API.
- No persistence.

## Constraints

- CommonJS (`module.exports`).
- No new npm dependencies.
- Must be testable with injected `delayFn` and clock to avoid real 1-second waits in tests.
