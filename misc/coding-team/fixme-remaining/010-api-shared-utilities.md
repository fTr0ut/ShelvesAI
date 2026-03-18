# 010 — API Shared Utilities: Normalization, Error Handling, Config

## Context

Multiple duplication and debt items that are best addressed together because they all involve creating shared utility modules:

1. **DUP-1**: String normalization functions (`normalizeString`, `normalizeStringArray`, `normalizeTags`) duplicated in `shelvesController.js`, `collectables.js` routes, `profileController.js`.
2. **DUP-2**: Pagination parameter parsing duplicated across controllers. `api/database/queries/utils.js` has `parsePagination()` but it's not used consistently.
3. **DUP-3**: Ownership verification (`WHERE id = $1 AND owner_id = $2`) repeated in `shelves.js`, `wishlists.js`, `lists.js`, `needsReview.js` query modules.
4. **DEBT-4** (partial): Magic numbers scattered across 10+ API files. Create `api/config/constants.js` to centralize them.
5. **DEBT-5**: No centralized error handling. Create `api/utils/errorHandler.js`.

## Objective

Extract shared utilities and update all call sites to use them.

## Scope

### DUP-1: Create `api/utils/normalize.js`

Extract from `api/controllers/shelvesController.js` (~lines 66-111):
- `normalizeString(val)` — trim + collapse whitespace
- `normalizeStringArray(val)` — parse string/array to clean array
- `normalizeTags(val)` — normalize + lowercase tags

Update imports in:
- `api/controllers/shelvesController.js`
- `api/routes/collectables.js`
- `api/controllers/profileController.js`

### DUP-2: Enforce `parsePagination` usage

`api/database/queries/utils.js` already exports `parsePagination(query, options)`. Find controllers that manually parse `limit`/`offset` and replace with `parsePagination`. Key files to check:
- `api/controllers/feedController.js`
- `api/controllers/discoverController.js`
- `api/controllers/favoritesController.js`
- Any other controller with `parseInt(req.query.limit` patterns

### DUP-3: Create `api/database/queries/ownership.js`

Create a shared helper:
```javascript
async function verifyOwnership(table, id, userId, client = null) {
  const q = client ? client.query.bind(client) : query;
  const result = await q(`SELECT id FROM ${table} WHERE id = $1 AND owner_id = $2`, [id, userId]);
  return result.rows.length > 0;
}
```

Update query modules to use it where the pattern is repeated.

### DEBT-4: Create `api/config/constants.js`

Centralize magic numbers currently scattered across files:
- `DEFAULT_OCR_CONFIDENCE_THRESHOLD` from shelvesController
- `AUTH_CACHE_TTL_MS`, `AUTH_CACHE_MAX_ENTRIES` from auth middleware
- `AGGREGATE_WINDOW_MINUTES`, `PREVIEW_PAYLOAD_LIMIT` from feed queries
- Other constants as encountered

Export as named constants. Update import sites.

### DEBT-5: Create `api/utils/errorHandler.js`

Create a structured error response utility:
```javascript
function sendError(res, status, message, details = {}) { ... }
function logError(context, error, metadata = {}) { ... }
```

This is a foundation — don't try to retrofit every controller in this task. Create the utility and apply it to 2-3 controllers as examples. Other controllers can be migrated incrementally.

## Non-goals

- Do not add Sentry/DataDog integration (DEBT-5 mentions it but it's a separate ops task).
- Do not create `mobile/src/config.js` in this task (that's task 011).
- Do not refactor the ownership verification in a way that changes query behavior — just extract the shared pattern.

## Constraints

- Do not change any API response shapes — callers depend on current formats.
- For DUP-3, the `table` parameter in `verifyOwnership` must be validated against an allowlist to prevent SQL injection (it's interpolated into the query string).
- Keep `parsePagination` defaults unchanged (limit: 20, max: 100).
