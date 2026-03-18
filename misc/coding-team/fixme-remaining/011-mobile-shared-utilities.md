# 011 — Mobile Shared Utilities: Cover URL, Loading Hook, Search Hook

## Context

Three duplication patterns across mobile screens:

1. **DUP-4**: `resolveCollectableCoverUrl()` and `resolveManualCoverUrl()` duplicated in `SocialFeedScreen.js`, `CollectableDetailScreen.js`, `ShelfDetailScreen.js`.
2. **DUP-5**: Loading state pattern (`useState` + `useEffect` + `try/catch/finally`) repeated in 5+ screens.
3. **DUP-6**: Search state pattern (`searchQuery`, `searchResults`, `searchLoading`, `searchTimeoutRef`) duplicated in `SocialFeedScreen.js`, `CheckInScreen.js`, `WishlistScreen.js`.

## Objective

Extract shared utilities and hooks, then update all call sites.

## Scope

### DUP-4: Create `mobile/src/utils/coverUrl.js`

Extract from `SocialFeedScreen.js` (~lines 67-117):
- `resolveCollectableCoverUrl(item, apiBase)`
- `resolveManualCoverUrl(item, apiBase)`

Update imports in:
- `mobile/src/screens/SocialFeedScreen.js`
- `mobile/src/screens/CollectableDetailScreen.js`
- `mobile/src/screens/ShelfDetailScreen.js`

### DUP-5: Create `mobile/src/hooks/useAsync.js`

Create a reusable hook:
```javascript
function useAsync(asyncFn, deps = []) {
  // Returns { data, loading, error, refresh }
  // Includes isMounted guard internally
}
```

This hook should:
- Accept an async function and dependency array
- Manage `data`, `loading`, `error` state
- Include built-in isMounted guard (so callers don't need to add their own)
- Expose a `refresh()` function for manual re-fetch
- Handle cleanup on unmount

Apply to 2-3 screens as examples:
- `mobile/src/screens/FavoritesScreen.js`
- `mobile/src/screens/FeedDetailScreen.js`
- `mobile/src/screens/AccountScreen.js`

Don't try to retrofit all 5+ screens in this task — the hook should be proven on a few screens first.

### DUP-6: Create `mobile/src/hooks/useSearch.js`

Create a reusable hook:
```javascript
function useSearch(searchFn, debounceMs = 300) {
  // Returns { query, setQuery, results, loading, clear }
  // Manages debounce timeout internally
  // Cleans up timeout on unmount
}
```

Apply to 1-2 screens as examples. Don't retrofit all screens in this task.

## Non-goals

- Do not refactor screen component structure (that's DEBT-7).
- Do not change API call patterns or response handling.

## Constraints

- The `useAsync` hook must handle the case where `asyncFn` changes between renders (use a ref to track the latest function).
- The `useSearch` hook must clear the timeout on unmount AND on navigation blur (to address BUG-19 pattern).
- Cover URL resolution logic must exactly match the existing implementations — don't change URL construction behavior.
- Keep the hooks simple. Don't add caching, retry logic, or other features that aren't needed yet.
