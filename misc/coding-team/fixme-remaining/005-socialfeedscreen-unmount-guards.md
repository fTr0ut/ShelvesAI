# 005 — SocialFeedScreen isMounted Guards + searchTimeout Fix

## Context

Two related issues in `mobile/src/screens/SocialFeedScreen.js` (1,958 lines):

1. **BUG-10 (remainder)**: The `load()` function (~lines 213-244) calls `setEntries()`, `setLoading()`, `setRefreshing()`, `setError()` without any mounted-state guard. This causes React warnings and potential crashes when navigating away during a load.

2. **BUG-19**: `searchTimeoutRef` (~lines 337-367) is cleared on unmount but can fire during navigation transition. The timeout should also be cleared on navigation blur.

## Objective

Add unmount-safe async guards to SocialFeedScreen following the established `useRef` pattern, and fix the search timeout leak.

## Scope

- `mobile/src/screens/SocialFeedScreen.js`

## Non-goals

- Do not decompose or refactor the file (that's DEBT-7, a separate initiative).
- Do not add AbortController — the codebase doesn't use it anywhere; stick with the `isMountedRef` pattern.

## Constraints

- Follow the `useRef(true)` pattern from `ShelfDetailScreen.js` (not the closure-local pattern from `FeedDetailScreen.js`), because SocialFeedScreen has multiple async callbacks that need to check mount state.
- Pattern to follow:
  ```javascript
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);
  ```
- Guard every `setState` call inside async functions with `if (!isMountedRef.current) return;`
- For BUG-19: add a navigation blur listener that clears `searchTimeoutRef.current`. Use React Navigation's `useIsFocused` or `navigation.addListener('blur', ...)`.
- Key async functions to guard: `load()`, `handleToggleLike()`, search handlers, any other async callback that calls setState.
