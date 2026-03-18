# 015 — Corrective Fixes from Code Review

## Context

The code reviewer identified 3 critical issues and 2 warnings from the task 001–013 implementation. This task addresses all of them.

## Critical Issue 1: Stale token in mobile refresh flow

**Problem**: `mobile/src/services/api.js:162` uses `preferredToken` (an in-memory token passed by callers) ahead of the stored token. Callers keeping an old in-memory token will keep refreshing/logging out based on that stale token even after a new token is saved to secure storage.

**Fix**: In `getValidToken()`, always read the token from secure storage (the source of truth) rather than preferring a caller-supplied in-memory token. If `preferredToken` is provided, it should only be used as a hint — the stored token should always be checked first since it may have been refreshed by another call.

## Critical Issue 2: Discover pagination still broken for deep offsets

**Problem**: In `api/controllers/discoverController.js`, the CTE computes `itemsPerGroup` from `safeLimit` only, then applies outer `OFFSET` later. For larger offsets, the CTE can't produce enough rows (`rn <= itemsPerGroup`), so pagination returns empty pages.

**Fix**: The `itemsPerGroup` calculation in the CTE's `WHERE rn <= $N` must account for the offset. The inner window needs to produce enough rows to satisfy both the offset and the limit. Change `itemsPerGroup` to `Math.ceil((safeLimit + safeOffset) / groupCount)` or similar, so the CTE produces enough rows for the outer OFFSET + LIMIT to work correctly. Alternatively, remove the per-group cap from the CTE and let the outer LIMIT/OFFSET handle all paging.

## Critical Issue 3: validateStringLengths incomplete coverage

**Problem**: `validateStringLengths` only checks scalar strings and doesn't enforce limits on array elements (e.g., tags). Some query/body text entry points still lack length guards.

**Fix**:
1. Update `validateStringLengths` in `api/middleware/validate.js` to also check array elements — if a field value is an array, validate each element's length.
2. Add `validateStringLengths` to remaining routes that accept text input but were missed:
   - Search query params on GET routes (e.g., `req.query.q`, `req.query.search`)
   - Any other text fields not yet covered

## Warning 1: ownership.js not adopted

**Problem**: `api/database/queries/ownership.js` was created but not actually used in query modules.

**Fix**: Update at least the `shelves.js` and `lists.js` query modules to use `verifyOwnership` where they currently have inline `WHERE id = $1 AND owner_id = $2` patterns.

## Warning 2: Dynamic Tailwind classes in UserAvatar

**Problem**: `admin-dashboard/src/components/UserAvatar.jsx` builds Tailwind size classes dynamically (`h-${size} w-${size}`), which can be purged in production builds.

**Fix**: Use a size-to-class mapping object instead of string interpolation:
```javascript
const sizeClasses = { 8: 'h-8 w-8', 10: 'h-10 w-10', 12: 'h-12 w-12', 16: 'h-16 w-16', 20: 'h-20 w-20' };
```

## Scope

- `mobile/src/services/api.js`
- `api/controllers/discoverController.js`
- `api/middleware/validate.js`
- `api/routes/*.js` (any missing string length validation)
- `api/database/queries/shelves.js`, `lists.js` (ownership adoption)
- `admin-dashboard/src/components/UserAvatar.jsx`

## Acceptance Criteria

- Token refresh uses stored token as source of truth
- Discover pagination works correctly for offset > 0 with category=all & item_type=all
- String length validation covers array elements and search query params
- At least 2 query modules use `verifyOwnership`
- UserAvatar uses static Tailwind classes
- `npm run test:backend` passes
- `npm run build` in admin-dashboard passes
