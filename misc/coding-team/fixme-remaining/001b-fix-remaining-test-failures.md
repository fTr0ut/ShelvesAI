# 001b — Fix Remaining Pre-existing Test Failures

## Context

After archiving `feed-detail.test.js` (task 001), 5 test suites still fail. These are pre-existing failures where the tests have drifted from the production code:

1. **`fuzzyMatching.test.js`** — tests pass `'book'` but code normalizes kind to `'books'` (plural)
2. **`googleGemini.test.js`** — test expects `kind: 'book'` but code returns `kind: 'books'`
3. **`shelvesController.test.js`** — controller now uses async job flow instead of synchronous; test expectations are stale
4. **`catalogIntegration.test.js`** — catalog lookup API changed; test expectations are stale
5. **`CollectableDiscoveryHook.test.js`** — references `findBySourceId` function that doesn't exist

## Objective

Fix all 5 failing test suites so `npm run test:backend` exits 0.

## Scope

- `api/__tests__/fuzzyMatching.test.js`
- `api/__tests__/googleGemini.test.js`
- `api/__tests__/shelvesController.test.js`
- `api/__tests__/catalogIntegration.test.js`
- `api/__tests__/CollectableDiscoveryHook.test.js` (find exact location — may be in `__tests__/` or elsewhere)

## Approach

For each failing test, determine whether:
- **The test expectations are wrong** (production code is correct, test needs updating) — update the test
- **The test is testing removed/renamed functionality** — update to test the current API
- **The test is completely obsolete** — archive to `api/_archive/tests/` with explanation

Do NOT change production code to make tests pass. The production code is the source of truth.

## Constraints

- Read the production code each test is testing to understand the current behavior before fixing the test.
- For kind normalization issues (`'book'` vs `'books'`): check how `shelfType.json` or the normalization logic works and align tests.
- For the async job flow in `shelvesController.test.js`: the controller now returns `202` with a `jobId` for vision processing. Update test expectations accordingly.
- For `CollectableDiscoveryHook.test.js`: find what function replaced `findBySourceId` and update the mock/expectations.
- Run `npm run test:backend` after all fixes to confirm green.

## Acceptance Criteria

- `npm run test:backend` exits 0 with all suites passing.
