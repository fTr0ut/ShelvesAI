# 001 — Fix Broken Test Suite

## Context

DEBT-1 was partially completed: stale test files were archived and Jest config updated. However, `feed-detail.test.js` remains in `api/__tests__/` and references Mongoose-style models (`User.create`, `Shelf.create`, `UserManual`, `UserCollection`) from a pre-PostgreSQL era. This test will fail because the app uses PostgreSQL, not MongoDB.

The goal is a fully green `npm run test:backend` run.

## Objective

Get all backend tests passing. Either rewrite `feed-detail.test.js` to work with the current PostgreSQL/mock architecture, or archive it if the coverage it provides is already handled elsewhere.

## Scope

- `api/__tests__/feed-detail.test.js` — the broken test file
- `api/__tests__/setup.js` — global test setup (mocks `database/pg` with `pool`, `query`, `getClient`, `transaction`)
- `api/jest.config.js` — if any config changes are needed

## Non-goals

- Do not rewrite or refactor any other test files.
- Do not add new test coverage beyond what `feed-detail.test.js` was testing.
- Do not change production code to make tests pass.

## Constraints

- The global mock in `setup.js` only mocks `pool`, `query`, `getClient`, `transaction`. If the rewritten test needs `queryWithContext` or `transactionWithContext`, add them to the global mock.
- Follow the mocking pattern used by the other passing tests (e.g., `visionPipeline.test.js`, `needsReview.test.js`) — they mock query modules directly rather than hitting a real DB.
- If the test is archived instead of rewritten, move it to `api/_archive/tests/` and document why.

## Acceptance Criteria

- `npm run test:backend` exits 0 with all suites passing.
