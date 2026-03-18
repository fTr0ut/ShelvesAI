# 009 — Mobile Token Refresh Mechanism

## Context

SEC-11 (remainder): `mobile/src/services/api.js` was migrated to `expo-secure-store` with token format and expiration validation. However, when a token expires, `getValidToken()` clears it and calls `notifyAuthError('expired')`, which triggers a hard logout. There is no refresh token flow — users must re-enter credentials every time their JWT expires.

## Objective

Implement a token refresh mechanism so users aren't hard-logged-out on token expiry.

## Scope

### Backend (API)

- Add `POST /api/auth/refresh` endpoint that:
  - Accepts a valid (or recently-expired) JWT
  - Validates the user still exists and is not suspended
  - Issues a new JWT with a fresh expiration
  - Optionally: issue a separate long-lived refresh token stored in the DB (more secure but more complex)

### Mobile

- `mobile/src/services/api.js` — add refresh logic:
  - Before API calls, check if token is near expiry (e.g., within 5 minutes)
  - If near expiry, call refresh endpoint to get a new token
  - Store the new token via `saveToken()`
  - If refresh fails (e.g., user suspended, refresh token expired), then fall back to hard logout

## Non-goals

- Do not implement OAuth2-style refresh token rotation with separate refresh token storage on first pass. A simpler approach (re-issue JWT using the current JWT before it fully expires) is acceptable.
- Do not add biometric re-authentication.

## Constraints

- The current `TOKEN_EXPIRY_SKEW_SECONDS` is 30 seconds. The refresh window should be larger (e.g., 5 minutes before expiry).
- The refresh endpoint must still validate the JWT signature — don't accept arbitrary tokens.
- Consider a short grace period for recently-expired tokens (e.g., accept tokens expired within the last 5 minutes for refresh only).
- Add rate limiting to the refresh endpoint to prevent abuse.
- The `api/middleware/auth.js` cache should be considered — a refreshed token will have a new signature, so cached auth entries for the old token should naturally expire via TTL.
