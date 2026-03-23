# ShelvesAI Dependency Tree

> **Maintenance rule:** Any agent making changes to the codebase MUST update this file to reflect new files, removed files, changed imports, new tables, or new routes. This is a living document.
> **Recent changes mandate:** Any agent making changes to the codebase MUST append a dated entry to the **Recent Changes Log** section in this file before finishing work.

Last updated: 2026-03-23

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Recent Changes Log](#recent-changes-log)
3. [Cross-Component Dependencies](#cross-component-dependencies)
4. [API Dependency Tree](#api-dependency-tree)
5. [Mobile Dependency Tree](#mobile-dependency-tree)
6. [Website Dependency Tree](#website-dependency-tree)
7. [Admin Dashboard Dependency Tree](#admin-dashboard-dependency-tree)
8. [Database Schema Map](#database-schema-map)
9. [External Service Integrations](#external-service-integrations)
10. [Shared Module](#shared-module)

---

## System Overview

```
ShelvesAI/
ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ api/              Express 5 REST API (Node.js, CommonJS, port 5001)
ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ mobile/           Expo SDK 54 / React Native 0.81 / React 19
ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ website/          Next.js 16 App Router marketing + account flows
ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ admin-dashboard/  Vite 7 + React 18 SPA (port 5173)
ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ shared/           Design tokens (ES module, consumed by mobile via Metro)
ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ docker-compose.yml  PostgreSQL 16 + pgAdmin (local dev)
```

**Communication patterns:**
- `mobile ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api`: REST over HTTPS, Bearer JWT auth, token in expo-secure-store
- `website ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api`: REST over HTTPS for password reset validate/update
- `admin-dashboard ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api`: REST via `/api/admin/*`, HttpOnly cookie auth + CSRF header
- `shared ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ mobile`: Metro watchFolders (not a package, direct file import)
- `shared ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ admin-dashboard`: NOT consumed (admin uses Tailwind)
- `shared ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api`: NOT consumed

---

## Recent Changes Log

> **Mandate for all agents:** For every codebase change, append one entry here using `YYYY-MM-DD | area | summary`.
> Include only concrete, merged-in-file impacts (routes/contracts/imports/tables/workflow behavior), not exploratory notes.

- 2026-03-22 | vision-workflow | Added explicit vision completion contract fields across API and mobile consumption: `addedCount`, `needsReviewCount`, `existingCount`, `extractedCount`, `summaryMessage`; documented sync, async status, and catalog lookup payload expectations.
- 2026-03-23 | vision-workflow | Joined enrichment requests to original Gemini vision extraction using multi-turn chat sessions (`startChat`/`sendMessage`). `detectShelfItemsFromImage()` now returns `{ items, conversationHistory }`. `enrichWithSchema()` and `enrichWithSchemaUncertain()` accept optional `conversationHistory` param ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â when provided and vision/text models match, enrichment continues the chat session (image context preserved). "Other" shelf search enrichment also uses chat mode. New private helper `_executeEnrichmentRequest()` handles chat-vs-standalone branching. `visionPipeline.js` threads `conversationHistory` from `extractItems()` through `processImage()` to both enrichment calls. Fully backward-compatible (MLKit rawItems path, model mismatch, enrichment disabled all fall back to standalone mode).
- 2026-03-23 | vision-workflow | Consolidated "other" shelf vision pipeline from 2 Gemini calls to 1. `detectShelfItemsFromImage()` now passes `tools: [{ googleSearch: {} }]` on the vision `generateContent` call for "other" shelves, getting full metadata + search grounding in a single request. Removed the separate Step 2 search enrichment block and the `other_initial` prompt from `visionSettings.json`. Conversation history is now returned for all shelf types including "other".
- 2026-03-23 | vision-workflow | Added Gemini 2.5 thinking budget control to `detectShelfItemsFromImage()`: `thinkingBudget: 0` for standard shelf OCR (pure perception, no reasoning cost), `thinkingBudget: 3000` for "other" shelves (search grounding + reasoning). Enrichment calls (`_executeEnrichmentRequest`) use default/unlimited thinking. Also bumped `DEFAULT_REQUEST_TIMEOUT_MS` from 10s to 60s and passed `requestOptions: { timeout }` to SDK `getGenerativeModel()` for proper fetch-level `AbortController` timeout.
- 2026-03-23 | vision-workflow | Hardened vision extraction failure handling: `detectShelfItemsFromImage()` now throws on Gemini transport/provider failures (instead of returning empty `items`), repairs truncated JSON arrays when possible, and returns an extraction warning for partial recovery. `VisionPipelineService.processImage()` now carries extraction warnings into the existing `warnings` response payload.
- 2026-03-23 | vision-workflow | Added match observability logs in `VisionPipelineService`: when extracted items resolve to existing records, logs now include `sourceTable` and `sourceId` for `collectables` and `user_manuals` matches (plus `collectionId` for `user_collections` manual links).
- 2026-03-23 | api-logging | Disabled request-level HTTP logging middleware in `api/server.js` (removed `middleware/requestLogger` mount). GET/POST request console logs and request-driven writes to `job_runs`/`job_events` are no longer emitted by default request handling.
- 2026-03-23 | workflow-job-context | Added `middleware/workflowJobContext.js` and mounted it for workflow POST routes (`/api/shelves/:shelfId/vision`, `/api/shelves/:shelfId/catalog-lookup`) to auto-assign request job IDs via AsyncLocalStorage without restoring global request DB logging.
- 2026-03-23 | market-value | Added `market_value` + `market_value_sources` schema support on `collectables` and `user_manuals` (new migration `20260323020000_add_market_value_to_collectables_and_user_manuals` + init schema update). Wired Gemini prompts/schema parsing to request market value with source links, persisted values in vision/manual/collectable save flows, and intentionally omitted `marketValueSources` from API response payloads for now.
- 2026-03-23 | other-shelf-dedupe | Hardened "other" manual matching with canonical normalization + barcode + conservative fuzzy matching (`fuzzy_auto`/`fuzzy_review`), added in-scan dedupe (`barcode` -> `manualFingerprint` -> canonical title+creator), and routed borderline matches to `needs_review` as `possible_duplicate`. Applied to both `VisionPipelineService` and review completion flows (`controllers/shelvesController.js`, `routes/unmatched.js`).
- 2026-03-23 | vision-idempotency | Added persistent image-result cache for `POST /api/shelves/:shelfId/vision` (`database/queries/visionResultCache.js`, migration `20260323040000_create_vision_result_cache`). Controller now hashes image bytes, logs cache hit/miss, short-circuits sync/async cache hits, and stores successful uncached pipeline results with TTL.
- 2026-03-22 | dev-workflow | Added `npm run dev:local` scripts to both `api/` and `mobile/` for fully local development. API: `server.js` now loads `.env.local` overrides (highest priority); `database/pg.js` uses development defaults matching `knexfile.js` (localhost/shelves/localdev123/shelvesai); added `cross-env` devDep. Mobile: new `scripts/dev-local.js` reads `LOCAL_API_ADDRESS` from `.env.local` (default `http://localhost:5001`), sets `EXPO_PUBLIC_API_BASE`, spawns Expo; `app.config.js` accepts `LOCAL_API_ADDRESS` as fallback for `API_BASE`. New files: `api/.env.local.example`, `mobile/.env.local.example`, root `.env.local.example`.

---

## Cross-Component Dependencies

### API ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬Â Mobile Contract

| Mobile Service | API Route | Auth |
|---|---|---|
| `services/api.js` (apiRequest) | All `/api/*` endpoints | Bearer JWT |
| `services/feedApi.js` | `/api/feed/:eventId/like`, `/api/feed/:eventId/comments` | Bearer JWT |
| `services/newsApi.js` | `/api/discover/dismiss` | Bearer JWT |
| `services/pushNotifications.js` | `/api/push/register`, `/api/push/unregister`, `/api/push/preferences` | Bearer JWT |
| `services/ocr.js` | (on-device only, no API call) | N/A |
| `services/imageUpload.js` | (prepares assets only, upload via apiRequest) | N/A |

#### Vision Workflow Completion Contract (`mobile` <- `api`)

- `POST /api/shelves/:shelfId/vision` (sync complete path) now includes:
  - `addedCount`
  - `needsReviewCount`
  - `existingCount`
  - `extractedCount`
  - `summaryMessage`
  - optional `cached` boolean (true when same-photo idempotency served a cached result)
- `GET /api/shelves/:shelfId/vision/:jobId/status` (async complete path, `result`) now includes:
  - `addedCount`
  - `needsReviewCount`
  - `existingCount`
  - `extractedCount`
  - `summaryMessage`
  - optional `cached` boolean (true when same-photo idempotency served a cached result)
- `POST /api/shelves/:shelfId/catalog-lookup` now includes the same completion fields:
  - `addedCount`, `needsReviewCount`, `existingCount`, `extractedCount`, `summaryMessage`
- Consumer paths:
  - `mobile/src/screens/ShelfDetailScreen.js` uses these fields to render non-ambiguous completion alerts.
  - `mobile/src/hooks/useVisionProcessing.js` uses these fields for background toast messaging and completion callbacks.

### API ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬Â Admin Dashboard Contract

| Admin Client Function | API Route | Auth |
|---|---|---|
| `login()` | `POST /api/admin/login` | None (sets cookie) |
| `getMe()` | `GET /api/admin/me` | Cookie |
| `logout()` | `POST /api/admin/logout` | Cookie + CSRF |
| `getStats()` | `GET /api/admin/stats` | Cookie |
| `getDetailedStats()` | `GET /api/admin/stats/detailed` | Cookie |
| `getSystemInfo()` | `GET /api/admin/system` | Cookie |
| `getUsers(params)` | `GET /api/admin/users` | Cookie |
| `getUser(userId)` | `GET /api/admin/users/:userId` | Cookie |
| `suspendUser(userId, reason)` | `POST /api/admin/users/:userId/suspend` | Cookie + CSRF |
| `unsuspendUser(userId)` | `POST /api/admin/users/:userId/unsuspend` | Cookie + CSRF |
| `toggleAdmin(userId)` | `POST /api/admin/users/:userId/toggle-admin` | Cookie + CSRF |
| `togglePremium(userId)` | `POST /api/admin/users/:userId/toggle-premium` | Cookie + CSRF |
| `getUserVisionQuota(userId)` | `GET /api/admin/users/:userId/vision-quota` | Cookie |
| `resetUserVisionQuota(userId)` | `POST /api/admin/users/:userId/vision-quota/reset` | Cookie + CSRF |
| `setUserVisionQuota(userId, scansUsed)` | `PUT /api/admin/users/:userId/vision-quota` | Cookie + CSRF |
| `getRecentFeed(params)` | `GET /api/admin/feed/recent` | Cookie |
| `getJobs(params)` | `GET /api/admin/jobs` | Cookie |
| `getJob(jobId)` | `GET /api/admin/jobs/:jobId` | Cookie |
| `getAuditLogs(params)` | `GET /api/admin/audit-logs` | Cookie |
| `getSettings()` | `GET /api/admin/settings` | Cookie |
| `updateSetting(key, value, desc)` | `PUT /api/admin/settings/:key` | Cookie + CSRF |
| `getShelves(params)` | `GET /api/admin/shelves` | Cookie |
| `getShelf(shelfId)` | `GET /api/admin/shelves/:shelfId` | Cookie |
| `getShelfItems(shelfId, params)` | `GET /api/admin/shelves/:shelfId/items` | Cookie |

### API ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬Â Website Contract

| Website Route/Component | API Route | Auth |
|---|---|---|
| `app/WaitlistForm.tsx` (waitlist signup) | `POST /api/waitlist` | None |
| `app/reset-password/reset-password-client.tsx` (token validation) | `GET /api/auth/validate-reset-token?token=...` | None |
| `app/reset-password/reset-password-client.tsx` (password submit) | `POST /api/auth/reset-password` | None |

---

## API Dependency Tree

### Entry Points

```
api/index.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/server.js
  -> api/logger.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/services/newsCacheScheduler.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/services/newsSeenCleanupScheduler.js

api/server.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/resetPasswordPage.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/shelves.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/account.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/collectables.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/feed.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/friends.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/profile.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/wishlists.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/favorites.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/lists.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/unmatched.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/onboarding.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/config.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/checkin.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/notifications.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/ratings.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/discover.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/push.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/admin.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/manuals.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ api/routes/waitlist.js
```

### Runtime Logging Utilities

```
api/context.js
  (no internal imports)

api/logger.js
  -> api/context.js

api/middleware/requestLogger.js
  -> api/context.js
  -> api/logger.js
  -> api/database/queries/jobRuns.js
  (module retained but no longer mounted in `api/server.js`)

api/utils/jobRunner.js
  -> api/context.js
  -> api/logger.js
  -> api/database/queries/jobRuns.js

api/__tests__/requestLogger.test.js
  -> api/middleware/requestLogger.js
  -> api/database/queries/jobRuns.js

api/database/queries/jobRuns.test.js
  -> api/database/queries/jobRuns.js
  -> api/database/pg.js
```

### Routes ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Controllers ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Queries/Services

#### auth
```
routes/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/authController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js

controllers/authController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/passwordReset.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/emailService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/adminAuth.js
```

#### shelves
```
routes/shelves.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/shelvesController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js
  -> middleware/workflowJobContext.js (vision/catalog workflow routes only)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/imageValidation.js

controllers/shelvesController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/shelves.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/collectables.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/feed.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/needsReview.js
  -> database/queries/visionQuota.js
  -> database/queries/visionResultCache.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/manualMedia.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/fingerprint.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectableMatchingService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/BookCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/MovieCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/GameCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/visionPipeline.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/visionPipelineHooks.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/processingStatus.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/mediaUrl.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/manuals/otherManual.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/imageValidation.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/normalize.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ config/constants.js
```

#### feed
```
routes/feed.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/feedController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/eventSocialController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js

controllers/feedController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/feed.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/shelves.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/friendships.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/eventSocial.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/newsSeen.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/discovery/newsRecommendations.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/mediaUrl.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ config/constants.js

controllers/eventSocialController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/eventSocial.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/notifications.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js
```

#### friends
```
routes/friends.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/friendController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js

controllers/friendController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/friendships.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/notifications.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/mediaUrl.js
```

#### profile
```
routes/profile.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/profileController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/imageValidation.js

controllers/profileController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/users.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/shelves.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/profileMedia.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/mediaUrl.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/imageValidation.js
```

#### account
```
routes/account.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/accountController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js

controllers/accountController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/visionQuota.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/mediaUrl.js
  Guards: checks req.user.premiumLockedByAdmin before allowing is_premium update
```

#### collectables
```
routes/collectables.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/admin.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/collectables.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/fingerprint.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/kind.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/normalize.js
```

#### wishlists
```
routes/wishlists.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/wishlistController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js

controllers/wishlistController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/wishlists.js
```

#### favorites
```
routes/favorites.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/favoritesController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js

controllers/favoritesController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/favorites.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/collectables.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/feed.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/users.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/friendships.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/shelves.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/mediaUrl.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/errorHandler.js
```

#### lists
```
routes/lists.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/listsController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js

controllers/listsController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/lists.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/collectables.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/feed.js
```

#### ratings
```
routes/ratings.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/ratingsController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js

controllers/ratingsController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/ratings.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/collectables.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/shelves.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/feed.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/mediaUrl.js
```

#### notifications
```
routes/notifications.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/notificationController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js

controllers/notificationController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/notifications.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js
```

#### push
```
routes/push.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/pushController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js

controllers/pushController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/pushDeviceTokens.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/notificationPreferences.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/pushNotificationService.js
```

#### discover
```
routes/discover.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/discoverController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js

controllers/discoverController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/newsDismissed.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/errorHandler.js
```

#### unmatched
```
routes/unmatched.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/needsReview.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/shelves.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/collectables.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/fingerprint.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/manuals/otherManual.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectableMatchingService.js (lazy require)
```

#### checkin
```
routes/checkin.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/feed.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/collectables.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js
```

#### onboarding
```
routes/onboarding.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/onboardingController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js

controllers/onboardingController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/users.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js
```

#### admin
```
routes/admin.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/adminController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/authController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/admin.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/csrf.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js
  Routes (read, before CSRF):
    GET  /stats, /stats/detailed, /users, /feed/recent, /jobs, /jobs/:jobId
    GET  /settings, /users/:userId/vision-quota, /audit-logs
    GET  /shelves, /shelves/:shelfId, /shelves/:shelfId/items
  Routes (write, after CSRF):
    PUT  /settings/:key, /users/:userId/vision-quota
    POST /users/:userId/suspend, /unsuspend, /toggle-admin, /toggle-premium
    POST /users/:userId/vision-quota/reset

controllers/adminController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/admin.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/jobRuns.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/systemSettings.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/visionQuota.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/adminContent.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/config/SystemSettingsCache.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/adminAuth.js
```

#### manuals
```
routes/manuals.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ controllers/shelvesController.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js
```

#### config
```
routes/config.js
  (reads config/onboardingScreen.json via fs)
```

#### waitlist
```
routes/waitlist.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ middleware/validate.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ resend (Contacts API)
```

#### resetPasswordPage
```
routes/resetPasswordPage.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â serves reset-password web fallback + app deep-link bridge)
```

### Middleware Internal Dependencies

```
middleware/auth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  -> context.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/adminAuth.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ config/constants.js
  Selects: is_premium, premium_locked_by_admin ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ sets req.user.premiumLockedByAdmin

middleware/admin.js
  (no internal imports)

middleware/validate.js
  (no internal imports)

middleware/csrf.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/adminAuth.js

middleware/requestLogger.js
  -> context.js
  -> logger.js
  -> database/queries/jobRuns.js
middleware/workflowJobContext.js
  -> context.js
```

### Services Internal Dependencies

```
services/visionPipeline.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/googleGemini.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/processingStatus.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/visionPipelineHooks.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/fingerprint.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/kind.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/BookCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/MovieCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/GameCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/TvCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/MusicCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/manuals/otherManual.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/collectables.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/shelves.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/needsReview.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/feed.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ config/constants.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ config/visionSettings.json
  Data flow: extractItems() -> { items, conversationHistory, warning }
             processImage() threads conversationHistory to enrichUnresolved/enrichUncertain
             processImage() appends extraction warning to `warnings` payload when present

services/visionPipelineHooks.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â hook registry)

services/processingStatus.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â in-memory Map)

services/googleGemini.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ config/visionSettings.json
  Methods: detectShelfItemsFromImage() -> { items, conversationHistory, warning }
             "other" shelves: single call with tools: [{ googleSearch: {} }] for search grounding
             standard shelves: vision-only call, enrichment downstream
             transport/provider request failures throw `VISION_PROVIDER_UNAVAILABLE`/`VISION_EXTRACTION_FAILED`
             truncated JSON extraction responses are repaired to salvage complete items
           enrichWithSchema(items, shelfType, conversationHistory?)
           enrichWithSchemaUncertain(items, shelfType, conversationHistory?)
           _executeEnrichmentRequest(prompt, conversationHistory, label, options?)
  Chat mode: uses @google/generative-ai startChat({ history }) + sendMessage()
             when conversationHistory is available and visionModel === textModel

services/googleCloudVision.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â disabled)

services/collectableMatchingService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/collectables.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/fingerprint.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/BookCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/MovieCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/GameCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/TvCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/MusicCatalogService.js

services/collectables/fingerprint.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â crypto hashing)

services/collectables/kind.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/config/shelfTypeResolver.js

services/config/shelfTypeResolver.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ config/shelfType.json

services/catalog/BookCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/CatalogRouter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/openLibrary.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/hardcover.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ adapters/openlibrary.adapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ adapters/hardcover.adapter.js

services/catalog/MovieCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/CatalogRouter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/adapters/TmdbAdapter.js

services/catalog/GameCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/CatalogRouter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/adapters/IgdbAdapter.js

services/catalog/TvCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/CatalogRouter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/adapters/TmdbTvAdapter.js

services/catalog/MusicCatalogService.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/fingerprint.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ adapters/musicbrainz.adapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/config/shelfTypeResolver.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/MusicBrainzRequestQueue.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/CatalogRouter.js (lazy require)

services/catalog/MusicBrainzRequestQueue.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â FIFO request queue)

services/catalog/CoverArtBackfillHook.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/visionPipelineHooks.js (lazy require in register())

services/catalog/CatalogRouter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ config/apiContainers.json
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/MetadataScorer.js

services/catalog/MetadataScorer.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ config/metadataScoreConfig.json
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/config/SystemSettingsCache.js

services/catalog/metadataScore.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/MetadataScorer.js

services/config/SystemSettingsCache.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/systemSettings.js (lazy require, cache miss only)

services/catalog/adapters/TmdbAdapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/RateLimiter.js

services/catalog/adapters/TmdbTvAdapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/RateLimiter.js

services/catalog/adapters/IgdbAdapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/RateLimiter.js

services/catalog/adapters/MusicBrainzAdapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/fingerprint.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ adapters/musicbrainz.adapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/withTimeout.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/MusicCatalogService.js (lazy require)

services/catalog/adapters/DiscogsAdapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/fingerprint.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ adapters/discogs.adapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/withTimeout.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/RateLimiter.js

services/openLibrary.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/RateLimiter.js

services/hardcover.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/RateLimiter.js

services/emailService.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â uses resend)

services/pushNotificationService.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â uses expo-server-sdk)

services/s3.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â uses @aws-sdk/client-s3)

services/mediaUrl.js
  (no internal imports)

services/manuals/otherManual.js
  (no internal imports)

services/newsCacheScheduler.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ jobs/refreshNewsCache.js
  -> utils/jobRunner.js

services/newsSeenCleanupScheduler.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/newsSeen.js
  -> utils/jobRunner.js

services/discovery/newsRecommendations.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/newsSeen.js

services/discovery/CollectableDiscoveryHook.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/collectables.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/fingerprint.js

services/discovery/TmdbDiscoveryAdapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/RateLimiter.js

services/discovery/IgdbDiscoveryAdapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/RateLimiter.js

services/discovery/BlurayDiscoveryAdapter.js
  (uses cheerio for scraping)

services/discovery/NytBooksDiscoveryAdapter.js
  (no internal imports)
```

### Jobs Internal Dependencies

```
jobs/refreshNewsCache.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/discovery/TmdbDiscoveryAdapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/discovery/IgdbDiscoveryAdapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/discovery/BlurayDiscoveryAdapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/discovery/NytBooksDiscoveryAdapter.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js

jobs/resetAndRefreshNewsCache.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ jobs/refreshNewsCache.js

jobs/refreshCollectableMetadata.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/* (catalog services)

jobs/refreshTmdbCoverCache.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/s3.js

jobs/cleanupNeedsReview.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
```

### Scripts Internal Dependencies

```
scripts/backfillMetascore.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/catalog/MetadataScorer.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/config/shelfTypeResolver.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/utils.js

scripts/backfill-missing-cover-media.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/queries/media.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ logger.js
```

### Database Query Dependencies

```
database/pg.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â pg Pool singleton)

database/queries/utils.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â pure helpers)

database/queries/auth.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/shelves.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/collectables.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js, database/queries/media.js, services/collectables/kind.js, database/queries/jobRuns.js, context.js
database/queries/feed.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js, config/constants.js
database/queries/eventSocial.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/friendships.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/users.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/notifications.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/needsReview.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/wishlists.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/favorites.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/lists.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/ratings.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/ownership.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
database/queries/media.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, services/s3.js, utils/imageValidation.js
database/queries/manualMedia.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, services/s3.js
database/queries/profileMedia.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, services/s3.js
database/queries/passwordReset.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
database/queries/visionQuota.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, services/config/SystemSettingsCache.js (lazy, for getMonthlyQuotaAsync)
database/queries/pushDeviceTokens.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/notificationPreferences.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/systemSettings.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/newsSeen.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
database/queries/newsDismissed.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js
database/queries/admin.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
database/queries/adminContent.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ database/pg.js, database/queries/utils.js
```

### Utility Dependencies

```
utils/errorHandler.js       (no internal imports)
utils/normalize.js           (no internal imports)
utils/adminAuth.js           (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â uses crypto)
utils/imageValidation.js     (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â uses file-type, image-size)
utils/withTimeout.js         (no internal imports)
utils/payloadLogger.js       (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â uses fs)
utils/RateLimiter.js         (no internal imports)
```

### Adapters

```
adapters/openlibrary.adapter.js  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â transforms API responses)
adapters/hardcover.adapter.js    (no internal imports)
adapters/tmdb.adapter.js         (no internal imports)
adapters/tmdbTv.adapter.js       (no internal imports)
adapters/musicbrainz.adapter.js  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/fingerprint.js
adapters/discogs.adapter.js      ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/collectables/fingerprint.js
```

### Config Files (data, not code)

```
config/constants.js              (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â env-backed constants)
config/shelfType.json            (shelf type definitions + aliases)
config/visionSettings.json       (per-type OCR/confidence thresholds + prompts; types: books, movies, games, tv, vinyl, other)
config/visionProgressMessages.json (user-facing progress strings)
config/onboardingScreen.json     (onboarding screen config)
config/apiContainers.json        (catalog API routing config)
config/metadataScoreConfig.json  (per-type metadata scoring weights + field definitions)
```

---

## Mobile Dependency Tree

### Entry Point

```
mobile/index.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ mobile/src/polyfills/index.js
      ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ mobile/src/polyfills/message-channel.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ mobile/src/App.js
```

### App.js (Root)

```
mobile/src/App.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/AuthContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ThemeContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/PushContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ToastContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ navigation/BottomTabNavigator.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ navigation/linkingConfig.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/api.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ components/Toast.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ screens/* (all 33 screens listed below)
```

### Context Providers

```
context/AuthContext.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â pure createContext)

context/ThemeContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ theme/index.js (dark theme)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ theme/theme_light.js

context/ToastContext.js
  (no internal imports)

context/PushContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/pushNotifications.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/AuthContext.js
```

### Navigation

```
navigation/BottomTabNavigator.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ThemeContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ screens/SocialFeedScreen.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ screens/ShelvesScreen.js

navigation/linkingConfig.js
  (no internal imports)
```

### Services

```
services/api.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â leaf node)

services/feedApi.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/api.js

services/newsApi.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/api.js

services/pushNotifications.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/api.js

services/imageUpload.js
  (no internal imports)

services/ocr.js
  (no internal imports)
```

### Hooks

```
hooks/useSearch.js           (no internal imports)
hooks/useAsync.js            (no internal imports)

hooks/useVisionProcessing.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ToastContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/api.js

hooks/useAuthDebug.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/api.js

hooks/useNews.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/AuthContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/api.js

hooks/useShelfDetailSync.js  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â createContext)
hooks/useFriendSearchSync.js (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â createContext)
```

### Components

```
components/Toast.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ThemeContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ToastContext.js

components/VisionProcessingModal.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ThemeContext.js

components/ShelfVisionModal.js
  (no internal imports)

components/FooterNav.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ assets/icons/*.png (legacy, likely unused)
```

### UI Components (barrel: components/ui/index.js)

```
ui/AccountSlideMenu.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/AuthContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ThemeContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ui/Avatar.js

ui/AppLayout.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ../../../../shared/theme/tokens.js  ÃƒÂ¢Ã¢â‚¬Â Ã‚Â CROSS-COMPONENT

ui/Avatar.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ui/CachedImage.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ theme/index.js

ui/Badge.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ theme/index.js
ui/Button.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ theme/index.js
ui/Card.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ theme/index.js
ui/Input.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ theme/index.js
ui/Skeleton.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ theme/index.js

ui/CachedImage.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ../../../../shared/theme/tokens.js  ÃƒÂ¢Ã¢â‚¬Â Ã‚Â CROSS-COMPONENT

ui/CategoryIcon.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ utils/iconConfig.js

ui/EmptyState.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ theme/index.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ui/Button.js

ui/Grid.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ../../../../shared/theme/tokens.js  ÃƒÂ¢Ã¢â‚¬Â Ã‚Â CROSS-COMPONENT
ui/Hero.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ../../../../shared/theme/tokens.js  ÃƒÂ¢Ã¢â‚¬Â Ã‚Â CROSS-COMPONENT
ui/ShelfListItem.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ../../../../shared/theme/tokens.js  ÃƒÂ¢Ã¢â‚¬Â Ã‚Â CROSS-COMPONENT

ui/StarRating.js ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ThemeContext.js
```

### News Components

```
components/news/NewsFeed.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ThemeContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ hooks/useNews.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ components/news/NewsSection.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ components/news/QuickCheckInModal.js

components/news/NewsSection.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ThemeContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ components/news/NewsCard.js

components/news/NewsCard.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ components/ui/CachedImage.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ThemeContext.js

components/news/QuickCheckInModal.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ThemeContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/ToastContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ context/AuthContext.js
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ services/api.js
```

### Screens ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Internal Dependencies

| Screen | Imports |
|---|---|
| LoginScreen | AuthContext, ThemeContext, api |
| ForgotPasswordScreen | AuthContext, ThemeContext, api |
| ResetPasswordScreen | AuthContext, ThemeContext, api |
| OnboardingPagerScreen | AuthContext, ThemeContext, api |
| UsernameSetupScreen | AuthContext, ThemeContext, api |
| OnboardingProfileRequiredScreen | AuthContext, ThemeContext |
| OnboardingProfileOptionalScreen | AuthContext, ThemeContext, api, imageUpload |
| SocialFeedScreen | ui/AccountSlideMenu, news/NewsFeed, news/NewsSection, news/QuickCheckInModal, AuthContext, ThemeContext, api, feedApi, newsApi, coverUrl |
| FeedDetailScreen | AuthContext, ThemeContext, api, feedApi, coverUrl |
| ShelvesScreen | ui/CategoryIcon, ui/AccountSlideMenu, AuthContext, ThemeContext, api |
| ShelfDetailScreen | AuthContext, ThemeContext, api, coverUrl, ocr, ui/CachedImage, ui/StarRating, ui/CategoryIcon, VisionProcessingModal, useVisionProcessing |
| ShelfCreateScreen | AuthContext, ThemeContext, api |
| ShelfEditScreen | AuthContext, ThemeContext, api |
| ShelfSelectScreen | ui/CategoryIcon, AuthContext, ThemeContext, api |
| ItemSearchScreen | AuthContext, ThemeContext, api |
| CollectableDetailScreen | AuthContext, ThemeContext, ui/CachedImage, ui/StarRating, ui/CategoryIcon, api, coverUrl, assets/tmdb-logo.svg |
| CheckInScreen | AuthContext, ThemeContext, api, useSearch |
| ManualEditScreen | AuthContext, ThemeContext, api |
| AccountScreen | AuthContext, ThemeContext, PushContext, api, useAsync |
| ProfileScreen | AuthContext, ThemeContext, api, imageUpload |
| ProfileEditScreen | AuthContext, ThemeContext, api, imageUpload |
| FriendSearchScreen | AuthContext, ThemeContext, api |
| FriendsListScreen | AuthContext, ThemeContext, api |
| WishlistsScreen | AuthContext, ThemeContext, api |
| WishlistScreen | AuthContext, ThemeContext, api, ui/CachedImage, ui/StarRating, ui/CategoryIcon |
| WishlistCreateScreen | AuthContext, ThemeContext, api |
| FavoritesScreen | ui/CategoryIcon, AuthContext, ThemeContext, api, useAsync, coverUrl |
| ListCreateScreen | AuthContext, ThemeContext, api |
| ListDetailScreen | ui/CategoryIcon, AuthContext, ThemeContext, api |
| UnmatchedScreen | AuthContext, ThemeContext, api |
| NotificationScreen | AuthContext, ThemeContext, api |
| NotificationSettingsScreen | AuthContext, ThemeContext, pushNotifications |
| AboutScreen | ThemeContext |

### Utils

```
utils/coverUrl.js    (no internal imports)
utils/mediaUrl.js    (no internal imports)
utils/iconConfig.js  (no internal imports)
```

### Theme

```
theme/index.js       (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â dark theme tokens)
theme/theme_light.js (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â light theme tokens)
```

---

## Website Dependency Tree

### Entry + Route Segments

```
website/src/app/layout.tsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ website/src/app/globals.css
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ website/src/content.json

website/src/app/page.tsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ website/src/content.json
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ website/src/app/WaitlistForm.tsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ website/src/app/page.module.css

website/src/app/WaitlistForm.tsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ website/src/app/waitlist-form.module.css
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ (env) NEXT_PUBLIC_API_BASE

website/src/app/reset-password/page.tsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ website/src/app/reset-password/reset-password-client.tsx

website/src/app/reset-password/reset-password-client.tsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ website/src/app/reset-password/reset-password.module.css
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ next/link
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ (env) NEXT_PUBLIC_API_BASE
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ (env) NEXT_PUBLIC_RESET_DEEP_LINK_BASE
```

### Config

```
website/next.config.ts   (no internal imports)
website/.env.example     (NEXT_PUBLIC_API_BASE, NEXT_PUBLIC_RESET_DEEP_LINK_BASE)
```

---

## Admin Dashboard Dependency Tree

### Entry Point

```
admin-dashboard/src/main.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/App.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/context/AuthContext.jsx (AuthProvider)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/index.css
```

### App.jsx (Router)

```
src/App.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/context/AuthContext.jsx (useAuth)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/Layout.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/pages/Login.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/pages/Dashboard.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/pages/Users.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/pages/Content.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/pages/ActivityFeed.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/pages/Jobs.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/pages/AuditLog.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/pages/Settings.jsx
```

### Context

```
src/context/AuthContext.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/api/client.js (login, logout, getMe)
```

### API Client

```
src/api/client.js
  (no internal imports ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â leaf node, uses axios)
  Exports: login, getMe, logout, getStats, getDetailedStats, getSystemInfo,
    getUsers, getUser, suspendUser, unsuspendUser, toggleAdmin, togglePremium,
    getUserVisionQuota, resetUserVisionQuota, setUserVisionQuota,
    getRecentFeed, getJobs, getJob, getAuditLogs,
    getSettings, updateSetting,
    getShelves, getShelf, getShelfItems
```

### Pages

```
src/pages/Login.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/context/AuthContext.jsx (useAuth)

src/pages/Dashboard.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/api/client.js (getStats, getSystemInfo, getDetailedStats, getRecentFeed)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/StatsCard.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/UserAvatar.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/utils/errorUtils.js

src/pages/Users.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/api/client.js (getUsers)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/UserTable.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/UserDetailModal.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/Pagination.jsx

src/pages/Content.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/api/client.js (getShelves)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/UserAvatar.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/Pagination.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/ShelfDetailModal.jsx

src/pages/ActivityFeed.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/api/client.js (getRecentFeed)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/UserAvatar.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/Pagination.jsx

src/pages/Jobs.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/api/client.js (getJobs)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/Pagination.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/JobDetailModal.jsx

src/pages/AuditLog.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/api/client.js (getAuditLogs)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/Pagination.jsx

src/pages/Settings.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/context/AuthContext.jsx (useAuth)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/api/client.js (getSettings, updateSetting)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/utils/errorUtils.js
```

### Components

```
src/components/Layout.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/Sidebar.jsx

src/components/Sidebar.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/context/AuthContext.jsx (useAuth)

src/components/UserTable.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/UserAvatar.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/UserBadge.jsx (SuspendedBadge, AdminBadge, PremiumBadge)

src/components/UserDetailModal.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/api/client.js (getUser, suspendUser, unsuspendUser, toggleAdmin, togglePremium, getUserVisionQuota, resetUserVisionQuota, setUserVisionQuota)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/UserAvatar.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/UserBadge.jsx (default: UserBadge)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/utils/errorUtils.js

src/components/JobDetailModal.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/api/client.js (getJob)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/utils/errorUtils.js

src/components/ShelfDetailModal.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/api/client.js (getShelf, getShelfItems)
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/UserAvatar.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/components/Pagination.jsx
  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ src/utils/errorUtils.js

src/components/StatsCard.jsx     (uses react-router-dom useNavigate)
src/components/UserBadge.jsx     (leaf ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no internal imports)
src/components/UserAvatar.jsx    (leaf ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no internal imports)
src/components/Pagination.jsx    (leaf ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no internal imports)
```

### Utils

```
src/utils/errorUtils.js          (leaf ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no internal imports)
```

### Reverse Dependency Map (who imports each file)

| File | Imported By |
|---|---|
| `api/client.js` | AuthContext, Dashboard, Users (via UserDetailModal), Content (via ShelfDetailModal), ActivityFeed, Jobs (via JobDetailModal), AuditLog, Settings |
| `context/AuthContext.jsx` | main, App, Login, Settings, Sidebar |
| `components/Layout.jsx` | App |
| `components/Sidebar.jsx` | Layout |
| `components/StatsCard.jsx` | Dashboard |
| `components/UserTable.jsx` | Users |
| `components/UserDetailModal.jsx` | Users |
| `components/JobDetailModal.jsx` | Jobs |
| `components/ShelfDetailModal.jsx` | Content |
| `components/UserBadge.jsx` | UserTable, UserDetailModal |
| `components/UserAvatar.jsx` | UserTable, UserDetailModal, Dashboard, ActivityFeed, Content, ShelfDetailModal |
| `components/Pagination.jsx` | Users, ActivityFeed, Jobs, AuditLog, Content, ShelfDetailModal |
| `utils/errorUtils.js` | Dashboard, UserDetailModal, JobDetailModal, ShelfDetailModal, Settings |

---

## Database Schema Map

### Tables and Relationships

```
users (UUID PK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< shelves (user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< user_collections (shelf_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ collectables (collectable_id FK) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬> collectables table
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ user_manuals (manual_id FK) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬> user_manuals table
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡         (CHECK: exactly one of collectable_id or manual_id)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< needs_review (shelf_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< user_manuals (user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ cover_media_path (S3/local)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< user_ratings (user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ collectable_id FK ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬> collectables
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ manual_id FK ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬> user_manuals
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< friendships (requester_id / addressee_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< event_aggregates (user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< event_logs (aggregate_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< event_likes (aggregate_id FK, user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< event_comments (aggregate_id FK, user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< notifications (user_id FK, actor_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< push_device_tokens (user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ notification_preferences (user_id PK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ user_vision_quota (user_id PK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< password_reset_tokens (user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< wishlists (user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< wishlist_items (wishlist_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< user_favorites (user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ collectable_id FK ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬> collectables
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ manual_id FK ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬> user_manuals
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< user_lists (user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡     ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< user_list_items (list_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< user_news_seen (user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< user_news_dismissed (user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ profile_media (user_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ premium_locked_by_admin (BOOLEAN, default FALSE)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< admin_action_logs (admin_id FK)

job_runs (job_id TEXT PK)
  -> user_id (FK -> users.id, nullable)
  -> status in {running, completed, failed}
  -> http_method/http_path/http_status/ip_address/duration_ms
  -> metadata (JSONB), started_at, finished_at
  -> job_events (job_id FK)

job_events (BIGSERIAL PK)
  -> job_id (FK -> job_runs.job_id)
  -> level/message/metadata + created_at
vision_result_cache (PK: user_id + shelf_id + image_sha256)
  -> user_id (FK -> users.id)
  -> shelf_id (FK -> shelves.id)
  -> result_json (JSONB cached pipeline result)
  -> created_at, expires_at (TTL)

system_settings (key VARCHAR PK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ value (JSONB, not null)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ description (TEXT, nullable)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ updated_by (FK ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ users.id, nullable)

collectables (SERIAL PK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ fingerprint (SHA1 hash, unique)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ lightweight_fingerprint
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ kind ÃƒÂ¢Ã‹â€ Ã‹â€  {book, movie, game, album}
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< editions (collectable_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< media (collectable_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< news_items (collectable_id FK, nullable)

news_items (SERIAL PK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ category, item_type, source
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ expires_at (cache TTL)
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< user_news_seen (news_item_id FK)
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬< user_news_dismissed (news_item_id FK)
```

### Key Constraints

- `user_collections`: CHECK ensures exactly one of `collectable_id` or `manual_id` is set
- `user_collections`: UNIQUE partial index on `(user_id, shelf_id, manual_id)` when `manual_id IS NOT NULL` (prevents duplicate manual links on one shelf)
- `user_manuals`: UNIQUE partial index on `(user_id, shelf_id, manual_fingerprint)` when `manual_fingerprint IS NOT NULL` (prevents duplicate manual rows per shelf fingerprint)
- `friendships`: CHECK prevents self-friendship; status ÃƒÂ¢Ã‹â€ Ã‹â€  {pending, accepted, blocked}
- `shelves.type` ÃƒÂ¢Ã‹â€ Ã‹â€  {books, movies, games, vinyl, tv, other}
- `shelves.visibility` ÃƒÂ¢Ã‹â€ Ã‹â€  {private, friends, public}
- `users.email`: UNIQUE constraint
- `collectables.title`: GIN pg_trgm index for fuzzy search

### Row Level Security (RLS)

- **Tier 1** (user isolation): shelves, user_collections, user_manuals, user_ratings, needs_review, push_device_tokens, notification_preferences, user_vision_quota, wishlists, wishlist_items, user_favorites, user_lists, user_list_items
- **Tier 2** (visibility): shelves (public/friends), profiles
- **Tier 3** (complex joins): friendships, feed
- **Tier 4** (cascading): dependent tables
- Admin bypass via `is_current_user_admin()` DB function
- Context set via `SET LOCAL "app.current_user_id"` in `queryWithContext()` / `transactionWithContext()`

### Migration History (46 files, 2026-01-10 -> 2026-03-23)

| Migration | Tables/Columns Affected |
|---|---|
| `20260110_create_needs_review` | + `needs_review` |
| `20260112_add_profile_wishlists` | + `wishlists`, `wishlist_items`, `profile_media`, `user_favorites`, `user_lists`, `user_list_items` |
| `20260112_add_event_aggregates` | + `event_aggregates`, `event_logs`, `event_likes`, `event_comments` |
| `20260113_add_onboarding_completed` | + `users.onboarding_completed` |
| `20260114_add_cover_attribution_fields` | + `collectables.cover_image_url/source/attribution` |
| `20260115_add_checkin_events` | + `event_aggregates.checkin_status/visibility/note/collectable_id/manual_id` |
| `20260116_create_notifications` | + `notifications` |
| `20260116_add_other_manual_fields` | + `user_manuals.age_statement/special_markings/label_color/regional_item/edition/barcode/manual_fingerprint` |
| `20260117_add_collectables_system_name` | + `collectables.system_name` |
| `20260117_add_collectables_format` | + `collectables.format` |
| `20260118_create_user_ratings` | + `user_ratings` |
| `20260119_add_limited_edition_item_text` | + `user_manuals.limited_edition/item_specific_text` |
| `20260120_create_news_items` | + `news_items` |
| `20260120_add_physical_release_date` | + `news_items.physical_release_date` |
| `20260121_add_collectable_id_to_news` | + `news_items.collectable_id` |
| `20260121_add_collectables_genre_runtime` | + `collectables.genre[]/runtime` |
| `20260121_normalize_shelf_types_plural` | Data migration (shelf types ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ plural) |
| `20260121_create_user_news_seen` | + `user_news_seen` |
| `20260122_add_manual_id_to_ratings` | + `user_ratings.manual_id` |
| `20260122_add_votes_to_news` | + `news_items.votes` |
| `20260122_create_user_news_dismissed` | + `user_news_dismissed` |
| `20260124_create_push_device_tokens` | + `push_device_tokens` |
| `20260124_create_notification_preferences` | + `notification_preferences` |
| `20260125_add_unique_email` | + UNIQUE on `users.email` |
| `20260125_create_password_reset_tokens` | + `password_reset_tokens` |
| `20260126_add_manual_id_to_checkin` | + `event_aggregates.manual_id` |
| `20260126_create_user_vision_quota` | + `user_vision_quota` |
| `20260127_add_admin_suspension_flags` | + `users.is_admin/is_suspended/suspended_at/suspension_reason` |
| `20260127_add_admin_action_logs` | + `admin_action_logs` |
| `20260127_add_friendships_indexes` | + composite indexes on `friendships` |
| `20260127_add_notifications_partial_index` | + partial index on active notifications |
| `20260128_rls_infrastructure` | + `app_user` role, RLS infra |
| `20260128_rls_tier1` | RLS on user-owned tables |
| `20260128_rls_tier2` | RLS visibility policies |
| `20260128_rls_tier3` | RLS complex join policies |
| `20260128_rls_tier4` | RLS cascading policies |
| `20260128_add_manual_id_to_favorites` | + `user_favorites.manual_id` |
| `20260128_add_manual_cover_media` | + `user_manuals.cover_media_path` |
| `20260319_add_collectables_metascore` | + `collectables.metascore` (JSONB) |
| `20260319_create_system_settings` | + `system_settings` (key PK, value JSONB, description, updated_by FK, timestamps) |
| `20260320_set_premium_default_on` | `users.is_premium` default set to true |
| `20260322_create_job_logging_tables` | + `job_runs`, + `job_events` |
| `20260323_add_premium_admin_lock` | + `users.premium_locked_by_admin` (BOOLEAN DEFAULT FALSE NOT NULL) |
| `20260323_add_market_value_to_collectables_and_user_manuals` | + `collectables.market_value/market_value_sources`, + `user_manuals.market_value/market_value_sources` |
| `20260323_reduce_other_manual_duplicates` | Data cleanup + unique partial indexes for `user_collections(user_id,shelf_id,manual_id)` and `user_manuals(user_id,shelf_id,manual_fingerprint)` |
| `20260323_create_vision_result_cache` | + `vision_result_cache` table (`user_id,shelf_id,image_sha256` PK, `result_json`, TTL via `expires_at`) |

---

## External Service Integrations

| Service | Package | API Files | Env Vars |
|---|---|---|---|
| **PostgreSQL 16** | `pg` + `knex` | `database/pg.js`, `knexfile.js` | `DATABASE_URL` or `POSTGRES_*` |
| **Google Gemini AI** | `@google/generative-ai` | `services/googleGemini.js` | `GEMINI_API_KEY` |
| **Google Cloud Vision** | `@google-cloud/vision` | `services/googleCloudVision.js` (disabled) | `GOOGLE_APPLICATION_CREDENTIALS` |
| **OpenAI** | `openai` | (not currently imported) | `OPENAI_API_KEY` |
| **AWS S3** | `@aws-sdk/client-s3` | `services/s3.js` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `S3_PUBLIC_URL`, `AWS_REGION` |
| **Resend** | `resend` | `services/emailService.js`, `routes/waitlist.js` | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_AUDIENCE_ID` |
| **Expo Push** | `expo-server-sdk` | `services/pushNotificationService.js` | (uses Expo tokens) |
| **TMDB** | `node-fetch` | `adapters/TmdbAdapter.js`, `TmdbTvAdapter.js`, `TmdbDiscoveryAdapter.js` | `TMDB_API_KEY` |
| **IGDB** | `node-fetch` | `adapters/IgdbAdapter.js`, `IgdbDiscoveryAdapter.js` | `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` |
| **OpenLibrary** | `node-fetch` | `services/openLibrary.js`, `adapters/openlibrary.adapter.js` | (public API) |
| **Hardcover** | `node-fetch` | `services/hardcover.js`, `adapters/hardcover.adapter.js` | `HARDCOVER_API_TOKEN` |
| **NYT Books** | `node-fetch` | `services/discovery/NytBooksDiscoveryAdapter.js` | `NYT_BOOKS_API_KEY` |
| **Bluray.com** | `cheerio` | `services/discovery/BlurayDiscoveryAdapter.js` | (scraping, no key) |
| **MusicBrainz** | `node-fetch` | `services/catalog/MusicCatalogService.js`, `adapters/musicbrainz.adapter.js` | (public API, no key) |
| **Discogs** | `node-fetch` | `services/catalog/adapters/DiscogsAdapter.js`, `adapters/discogs.adapter.js` | `DISCOGS_USER_TOKEN` or `DISCOGS_CONSUMER_KEY` + `DISCOGS_CONSUMER_SECRET` |
| **Cover Art Archive** | `node-fetch` | `adapters/musicbrainz.adapter.js` | (public API, no key) |
| **Sentry** | `@sentry/react-native` | `mobile/index.js`, `mobile/src/services/api.js` | Sentry DSN in code |

---

## Shared Module

```
shared/
ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ theme/
ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡   ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ tokens.js    (ES module: colors, spacing, radii, typography, shadow)
ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ styles/
    ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ app.css
```

**Consumed by:**
- `mobile/` via Metro `watchFolders` in `metro.config.js`
  - `ui/AppLayout.js`, `ui/CachedImage.js`, `ui/Grid.js`, `ui/Hero.js`, `ui/ShelfListItem.js`

**NOT consumed by:**
- `api/` (no shared imports)
- `admin-dashboard/` (uses Tailwind, no shared imports)

---

## High-Impact Files (change these carefully)

These files have the most dependents or are critical infrastructure:

| File | Why |
|---|---|
| `api/database/pg.js` | Every query file depends on it; RLS context flows through it |
| `api/database/queries/utils.js` | Used by 20+ query files for camelCase conversion, pagination |
| `api/middleware/auth.js` | Guards every authenticated route |
| `api/config/constants.js` | Centralized magic numbers used across services |
| `mobile/src/services/api.js` | Every screen depends on it for HTTP calls |
| `mobile/src/context/AuthContext.js` | Every screen reads auth state from it |
| `mobile/src/context/ThemeContext.js` | Every screen reads theme from it |
| `shared/theme/tokens.js` | 5 mobile UI components import it directly |
| `admin-dashboard/src/api/client.js` | All admin API calls flow through it |
| `admin-dashboard/src/context/AuthContext.jsx` | All admin auth state flows through it |




