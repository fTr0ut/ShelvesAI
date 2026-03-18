# 007 — useVisionProcessing Polling Unmount Guard

## Context

BUG-20: In `mobile/src/hooks/useVisionProcessing.js` (~lines 70-95), `setInterval` polling doesn't check if the component is mounted before calling setState. This causes React state update warnings and potential crashes.

## Objective

Add an isMounted guard to the polling callback inside `useVisionProcessing`.

## Scope

- `mobile/src/hooks/useVisionProcessing.js`

## Non-goals

- Do not refactor the polling mechanism to use a different approach (e.g., WebSocket).
- Do not change the poll interval or retry logic.

## Constraints

- Use the `useRef(true)` pattern consistent with the rest of the codebase.
- Clear the interval AND set `isMountedRef.current = false` in the cleanup function.
- Guard all `setState` calls inside the polling callback with `if (!isMountedRef.current) return;`.
