# Mobile Crash Reporting (Sentry)

Last updated: 2026-03-18 UTC

## Scope

This document describes how crash/error reporting is wired for the mobile app in `mobile/`.

## Current Integration

- SDK: `@sentry/react-native`
- Init: `mobile/index.js`
- Expo plugin: `mobile/app.json` plugin `@sentry/react-native/expo`
- Metro integration: `mobile/metro.config.js` using `getSentryExpoConfig`
- React wrapper: `mobile/src/App.js` exports `Sentry.wrap(function App() { ... })`

## Important Config

- `Sentry.init` must use key `dsn` (not `dns`).
- Current init sets:
  - `enableNative: true`
  - `enableNativeCrashHandling: true`
  - `environment: __DEV__ ? 'development' : 'production'`
- Production API env is enforced in `mobile/eas.json`:
  - `EXPO_PUBLIC_USE_NGROK=false`
  - `EXPO_PUBLIC_API_BASE=https://api.shelvesai.com`

## App-Level Instrumentation

- API base resolution source is tagged in Sentry:
  - tag: `api_base_source`
  - context: `api_config`
- Authenticated user context is pushed via `Sentry.setUser(...)` in `mobile/src/App.js`.
- Bootstrap failures captured:
  - `/api/config/onboarding`
  - `/api/account`

## API-Level Instrumentation

In `mobile/src/services/api.js`:

- Network failures (`fetch` throws) are captured with tag `area=api_network`.
- 5xx API responses are captured with tag `area=api_server`.
- Token refresh failures are captured with tag `area=auth_refresh`.
- Successful silent token refresh adds breadcrumb category `auth`.

## Quick Validation

1. Start app with clean cache: `npx expo start -c`.
2. Trigger a test event from app code:
   - `Sentry.captureException(new Error('Sentry smoke test'))`
3. Verify event appears in Sentry `Issues` or `Events`.
4. In Sentry UI, set Environment filter to `All` while validating local/dev events.

## Common Failure Modes

- Typo `dns` instead of `dsn` in `Sentry.init`.
- Sentry initialized before import or referenced without import.
- Dashboard filters excluding current environment.
- Stale Metro cache after config changes.
- Production build using wrong API env and crashing before useful telemetry context is attached.

## Operational Notes

- DSN is allowed in client apps; it is not a secret token.
- Keep auth tokens and secrets out of Sentry extras/contexts.
- Remove verbose debug logging for production if log noise becomes high.
