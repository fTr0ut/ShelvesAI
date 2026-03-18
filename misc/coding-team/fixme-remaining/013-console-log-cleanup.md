# 013 — Console.log Cleanup in Production Mobile Code

## Context

DEBT-6: Several `console.log` and `console.warn` statements exist in production mobile code, leaking debug info and adding performance overhead.

Known locations:
- `mobile/src/App.js:86` — logs ngrok config
- `mobile/src/context/PushContext.js:65, 80, 128, 134` — logs push token info, notifications
- `mobile/src/screens/CheckInScreen.js:91` — logs search errors

## Objective

Remove or gate all `console.log`/`console.warn` statements in mobile production code behind `__DEV__` checks.

## Scope

- Search all files under `mobile/src/` for `console.log` and `console.warn` calls
- For debug/diagnostic logs: wrap in `if (__DEV__)` guard
- For error logging that should remain: keep `console.error` (these are legitimate error signals), but review whether `console.warn` calls are actually error-level or debug-level

## Non-goals

- Do not add a logging library or abstraction layer.
- Do not touch `console.error` calls (those are intentional error reporting).
- Do not touch files in `_archive/` or test files.

## Constraints

- `__DEV__` is a React Native global that is `true` in development and `false` in production builds. It does not need to be imported.
- Some `console.warn` calls may be legitimate warnings that should remain (e.g., in catch blocks for non-critical failures). Use judgment — if it's useful for production debugging, keep it; if it's development noise, gate it.
