# System Workflow Overview

Last updated: 2026-02-08 18:13:21 UTC

This document summarizes the active production workflows in this repository.

## Runtime Architecture

- `mobile/`: Expo React Native client.
- `api/`: Express API with JWT auth, PostgreSQL queries, and service integrations.
- `admin-dashboard/`: React + Vite dashboard for moderation/admin operations.
- Storage:
  - Primary data in PostgreSQL.
  - Media in local cache or S3 (`api/services/s3.js`).

## Authentication and Session

1. User logs in or registers through `/api/auth/*`.
2. JWT is stored on mobile and attached as `Bearer` token.
3. API `auth` middleware hydrates `req.user` with:
   - `id`
   - `username`
   - `isPremium`
   - `isAdmin`
4. Suspended users are blocked with `403 ACCOUNT_SUSPENDED`.

## Onboarding Gate

- App checks `/api/account` after auth.
- User stays in onboarding until required fields exist and `onboarding_completed=true`:
  - email
  - firstName
  - city
  - state
- Completion endpoint: `POST /api/onboarding/complete`.

## Premium Toggle and Vision Modes

Current product behavior:

- `is_premium` is user-toggleable in account settings (`PUT /api/account`), by design.
- Mobile uses that flag to choose scan mode:
  - Premium on: cloud vision job (`POST /api/shelves/:shelfId/vision`)
  - Premium off: on-device OCR + catalog lookup (`POST /api/shelves/:shelfId/catalog-lookup`)

Cloud vision flow:

1. Mobile submits base64 image to vision endpoint (async mode).
2. API creates a job and returns `202` + `jobId`.
3. Mobile polls `/api/shelves/:shelfId/vision/:jobId/status`.
4. Pipeline runs OCR -> matching -> catalog/enrichment -> shelf/review persistence.
5. Quota is decremented only for cloud runs.

Quota fallback:

- If cloud quota is exhausted (`429 quotaExceeded`), mobile falls back to on-device scan flow.

## Shelf and Item Management

- Shelves are user-owned (`/api/shelves`).
- Items can be:
  - Collectables from global catalog.
  - Manual items (`user_manuals`) for unmatched entries.
- `other` shelf type has a manual-first path with manual fingerprint dedupe.
- Review queue endpoints exist at both shelf scope and global unmatched scope.

## Feed and Social

- Events are written to `event_logs` and grouped into `event_aggregates`.
- `/api/feed` reads aggregates and attaches social summaries.
- Likes/comments target aggregate IDs (`/api/feed/:eventId/*`).
- Check-in and rating events can be merged into `checkin.rated` entries for display.

## Discover and News

- `/api/discover` supports optional auth and personalization when user context exists.
- News recommendations can be interleaved into feed `scope=all`.
- Dismiss actions are explicit user feedback (`POST /api/discover/dismiss`).

## Admin and Moderation

- Admin auth via `/api/admin/login`.
- Protected admin routes use `auth` + `requireAdmin` middleware.
- Admin actions (suspend/unsuspend/toggle-admin) are audit logged in `admin_action_logs`.

## Operational Risks Tracked

Known debt and security issues are tracked in `FIXME.md`.

Highest priority currently:

- catalog write endpoint authorization hardening
- media ingestion hardening (MIME/magic validation)
- password reset token logging removal when email transport is disabled
- stale/broken backend tests cleanup
