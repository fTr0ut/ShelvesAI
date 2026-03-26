# ShelvesAI Dependency Tree

> **Maintenance rule:** Any agent making changes to the codebase MUST update this file to reflect new files, removed files, changed imports, new tables, or new routes. This is a living document.
> **Recent changes mandate:** Any agent making changes to the codebase MUST append a dated entry to the **Recent Changes Log** section in this file before finishing work.

Last updated: 2026-03-26

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
├── api/              Express 5 REST API (Node.js, CommonJS, port 5001)
├── mobile/           Expo SDK 54 / React Native 0.81 / React 19
├── website/          Next.js 16 App Router marketing + account flows
├── admin-dashboard/  Vite 7 + React 18 SPA (port 5173)
├── shared/           Design tokens (ES module, consumed by mobile via Metro)
└── docker-compose.yml  PostgreSQL 16 + pgAdmin (local dev)
```

**Communication patterns:**
- `mobile → api`: REST over HTTPS, Bearer JWT auth, token in expo-secure-store
- `website → api`: REST over HTTPS for password reset validate/update
- `admin-dashboard → api`: REST via `/api/admin/*`, HttpOnly cookie auth + CSRF header
- `shared → mobile`: Metro watchFolders (not a package, direct file import)
- `shared → admin-dashboard`: NOT consumed (admin uses Tailwind)
- `shared → api`: NOT consumed

---

## Recent Changes Log

> **Mandate for all agents:** For every codebase change, append one entry here using `YYYY-MM-DD | area | summary`.
> Include only concrete, merged-in-file impacts (routes/contracts/imports/tables/workflow behavior), not exploratory notes.

- 2026-03-26 | market-value-ui-enhancements | Added market value estimate feature: new `user_market_value_estimates` DB table (migration `20260326000000`), new query module `database/queries/marketValueEstimates.js`, three new API endpoints on `/api/collectables/:id` (`market-value-sources` GET, `user-estimate` GET/PUT), new `MarketValueSourcesScreen` (registered in App.js root stack + BottomTabNavigator ShelvesTabStack). Updated `CollectableDetailScreen` to show "Est. Market Value" label for API-sourced values with clickable navigation to sources screen, and appends user estimate as "Your Estimate" metadata row when present.
- 2026-03-26 | mobile-navigation-persistent-shelves-footer | Added rollback-gated persistent footer flow for shelf details by introducing a nested Shelves stack inside `BottomTabNavigator` (`ShelvesHome`, `ShelfCreateScreen`, `ShelfSelect`, `ShelfDetail`, `ShelfEdit`, `ItemSearch`, `CollectableDetail`) behind `ENABLE_PERSISTENT_SHELVES_DETAIL_FOOTER`. Add-FAB now routes to nested `Shelves -> ShelfSelect` when enabled (legacy root `ShelfSelect` path retained when disabled). Added tab-parent-aware bottom spacing in `ShelfDetailScreen` and `CollectableDetailScreen` so list/scroll content and local floating actions clear the persistent tab bar only when rendered under tab navigation.
- 2026-03-25 | reviewed-republish-upsert-and-updated-label | Implemented stable reviewed re-publish workflow: added `user_collections.reviewed_event_log_id/reviewed_event_published_at/reviewed_event_updated_at` (migration `20260325201500_add_reviewed_event_link_to_user_collections` + init schema alter), exposed linkage fields in shelf-item payloads (`reviewedEventId`, `reviewPublishedAt`, `reviewUpdatedAt`), and added `feedQueries.upsertReviewedEvent(...)` to update existing reviewed event logs in place (or create/link fallback), with content-change guard on notes/rating/metadata and aggregate `last_activity_at` bump for changed republishes. Updated `shelvesController` collectable/manual note-share paths to use reviewed upsert + persist linkage on `user_collections`, updated mobile note-save payloads to pass optional `reviewedEventId`, and added reviewed `Updated on <absolute local datetime>` rendering across `SocialFeedScreen`, `FeedDetailScreen`, and `ProfileScreen`. Feed entry merge ordering now sorts by activity (`updatedAt` fallback) to keep re-published reviewed cards at the top.
- 2026-03-25 | reviewed-card-read-more-and-detail-expand | Updated reviewed-note UI behavior: in `SocialFeedScreen` reviewed cards now detect when note text is line-clamped and show a small `n/ click to read more` hint (with italicized `click to read more`), while `FeedDetailScreen` reviewed item notes no longer clamp to 2 lines so the full note text is shown.
- 2026-03-25 | reviewed-updated-indicator-and-share-default | Refined reviewed edit/publish UX in mobile: `CollectableDetailScreen` now auto-selects `Share to feed?` when owner opens note editor for an item already linked to a published reviewed event (`reviewedEventId/reviewPublishedAt/reviewUpdatedAt`), and Social feed reviewed cards now show an explicit `Updated` badge in the top-right metadata area plus robust `Updated on <absolute datetime>` fallback resolution from event-level timestamps when item-level review timestamps are absent. Applied the same fallback logic to reviewed timestamp labels in `FeedDetailScreen` and `ProfileScreen`.
- 2026-03-25 | reviewed-rating-collapse-bidirectional | Refined feed read-time collapse behavior in `api/controllers/feedController.js`: `mergeReviewedRatingPairs` now pairs `reviewed` and `item.rated` events in either order when same user/item occurs within `REVIEW_RATING_MERGE_WINDOW_MINUTES`, always omits paired standalone rating entries, and updates reviewed item rating from the paired rating payload. Matching now prefers strict `itemId` equality when present on both events, with collectable/manual identity fallback only when one side lacks `itemId` (legacy `/api/ratings` payloads). Expanded regression coverage in `api/__tests__/feedController.mergeCheckinRatingPairs.test.js` for before/after ordering, strict mismatched-itemId non-merge, and legacy no-itemId merge fallback.
- 2026-03-25 | reviewed-event-aggregation-disable-and-ui-fix | Updated feed event behavior to exclude `reviewed` from aggregate-window reuse in `api/database/queries/feed.js` (each reviewed post now gets its own aggregate/event card), tightened `reviewed`+`item.rated` merge logic in `api/controllers/feedController.js` to require exact matching `itemId` within `REVIEW_RATING_MERGE_WINDOW_MINUTES`, added regression coverage in `api/__tests__/feedRatingEventDedup.test.js` and `api/__tests__/feedController.mergeCheckinRatingPairs.test.js`, and adjusted `mobile/src/screens/SocialFeedScreen.js` reviewed card styling so review text is centered/non-italic while staying top-aligned alongside thumbnail with rating directly beneath the thumbnail.
- 2026-03-25 | reviewed-rating-merge-and-layout | Added feed-level merge behavior to combine `reviewed` + later `item.rated` events into one `reviewed` card when same user/item occurs within configurable window `REVIEW_RATING_MERGE_WINDOW_MINUTES` (default 120), including per-item identity matching (collectable/manual/title), consumed-rating pruning from standalone rating aggregates, and merged timestamp carry-forward. Added reviewed/rating merge coverage in `api/__tests__/feedController.mergeCheckinRatingPairs.test.js` (merge + non-merge cases). Updated `mobile/src/screens/SocialFeedScreen.js` reviewed card layout so review text renders inline in the card body (non-italic, aligned with thumbnail top) and rating (when present) renders directly beneath thumbnail.
- 2026-03-25 | replace-wrong-ocr-workflow | Implemented end-to-end shelf item replacement workflow for wrong OCR matches: added DB table `item_replacement_traces` (+ indexes/RLS + migrations `20260325010000_create_item_replacement_traces`, `20260325010010_add_item_replacement_traces_rls` + init schema update), new query module `database/queries/itemReplacementTraces.js`, new shelf routes `POST /api/shelves/:shelfId/items/:itemId/replacement-intent` and `POST /api/shelves/:shelfId/items/:itemId/replace`, controller validation/transaction flow for replacement intent+completion/failure, shelf payload hydration field `isVisionLinked`, and mobile replacement UX across `CollectableDetailScreen` (72h vision-linked CTA), `ShelfDetailScreen` (<=24h Replace/Delete/Cancel modal with preserved delete confirmation), and `ItemSearchScreen` (replacement mode prefill + replace submit + goBack success path). Added regression coverage in `api/__tests__/shelvesController.test.js` and query tests in `api/database/queries/itemReplacementTraces.test.js`.
| `20260326000000_create_user_market_value_estimates` | + `user_market_value_estimates` table (user estimates for collectable/manual market values, partial unique indexes, CHECK constraint) |
- 2026-03-25 | reviewed-feed-share-toggle | Added notes-editor `Share to feed?` toggle on `CollectableDetailScreen` (manual + collectable save paths) and wired backend `shareToFeed` handling into `PUT /api/shelves/:shelfId/items/:itemId/rating` and `PUT /api/shelves/:shelfId/manual/:itemId`. Added new shelf-scoped feed event type `reviewed` emitted only when sharing is enabled and saved notes are non-empty, with payload snapshot fields for item identity, notes, metadata, and the user's current decoupled rating. Updated feed mapping/display hints in `api/controllers/feedController.js` and mobile feed renderers (`SocialFeedScreen`, `FeedDetailScreen`, `ProfileScreen`) to render reviewed activity cards/details with notes + rating context. Added controller regression coverage in `api/__tests__/shelvesController.test.js` for reviewed-event emission and non-emission on cleared notes.
- 2026-03-25 | detail-rating-owner-label | Updated `CollectableDetailScreen` owner-rating block label to mirror handle-based notes labeling: read-only/friend shelf detail now renders `<ownerUsername>'s rating:` when owner username is available (fallback `Owner rating:`).
- 2026-03-25 | detail-notes-owner-label | Added owner-handle-aware notes labeling for read-only shelf detail flows: `shelves.getForViewing` now selects `owner_username`, `ShelfDetailScreen` passes `ownerUsername` into `CollectableDetail` navigation, and `CollectableDetailScreen` renders notes header as `<ownerUsername>'s Notes:` when viewer cannot edit notes (fallback remains `Your Notes`).
- 2026-03-25 | detail-notes-order-adjustment | Updated `CollectableDetailScreen` section ordering so `Your Notes` renders above `Details` metadata (remaining below rating/actions), preserving existing notes view/edit state behavior.
- 2026-03-25 | detail-notes-ui-modes | Refined `CollectableDetailScreen` note UX: `Your Notes` now renders above description (still below rating/actions), shows inline editor + save button when notes are empty, and switches to read-only text + pencil affordance when notes exist; tapping pencil toggles editor mode. Added edit-mode state sync so saved/cleared notes transition between read and edit modes correctly.
- 2026-03-25 | detail-notes-false-error-suppression | Updated `CollectableDetailScreen` notes-save error handling for collectables: when API returns `Item not found`, the client now verifies persisted shelf notes via `/api/shelves/:shelfId/items` and suppresses the modal if server state already matches the intended note, preventing false-negative error popups after successful saves.
- 2026-03-25 | detail-notes-fallback-hardening | Further hardened collectable notes persistence: `rateShelfItem` now auto-falls back by treating `:itemId` as a collectable-id candidate for notes-only updates when body `collectableId` is absent, and `CollectableDetailScreen` now sends `resolvedCollectableId` in notes-save payloads. Added regression coverage in `api/__tests__/shelvesController.test.js` for notes-only fallback without explicit `collectableId`.
- 2026-03-25 | detail-notes-itemid-fallback | Updated `api/controllers/shelvesController.rateShelfItem` to accept optional `collectableId` and resolve collection row fallback via `shelvesQueries.findCollectionByReference(...)` when `:itemId` is not a `user_collections.id`, then hydrate response/feed payload from the resolved row id; `CollectableDetailScreen` notes save now includes `collectableId` in `PUT /api/shelves/:shelfId/items/:itemId/rating` body for this fallback path. Added regression test in `api/__tests__/shelvesController.test.js` for notes-save fallback.
- 2026-03-25 | detail-notes-collectable-retry | Hardened `CollectableDetailScreen` notes save flow for collectables by retrying `PUT /api/shelves/:shelfId/items/:itemId/rating` with resolved shelf-item id from `/api/shelves/:shelfId/items` when initial id is a collectable id (404 path), and surfaced API error text in the notes save alert for faster diagnosis.
- 2026-03-25 | detail-notes-inline-edit | Extended `CollectableDetailScreen` with inline `Your Notes` review/edit UI for any owned shelf item (collectable or manual), including save-state handling and immediate local sync after edits; `ManualEditScreen` now merges updated manual + notes payload back into the originating detail route for instant return-state refresh; and `shelvesController.rateShelfItem` + `database/queries/shelves.updateItemRating` now accept optional `notes` updates on `PUT /api/shelves/:shelfId/items/:itemId/rating` without forcing a rating change (with regression coverage added in `api/__tests__/shelvesController.test.js`).
- 2026-03-25 | favorites-feed-suppression | Updated `api/controllers/favoritesController.addFavorite` to stop emitting `item.favorited` feed events entirely (removed `feedQueries.logEvent` favorite emission path and related controller-only logging payload wiring). Favoriting/unfavoriting behavior and API responses remain unchanged, but favorites no longer create social feed events.
- 2026-03-25 | feed-rating-dedup | Hardened duplicate-rating handling in backend event system: `ratingsQueries.setRating` now returns change metadata (`changed`, `previousRating`, `currentRating`) and skips unchanged writes; both `ratingsController.setRating` and legacy `shelvesController.rateShelfItem` now emit `item.rated` only when rating values change; `feed.logEvent` now acquires advisory transaction locks per aggregate scope and treats `item.rated` as per-item upsert within an open aggregate (update existing `event_logs` payload + recompute aggregate `item_count`/`preview_payloads`) so same-item re-rates update in place instead of duplicating; `feedController.mergeCheckinRatingPairs` now consumes each rating item once (most-recent check-in wins) to prevent one rating merging into multiple check-ins. Added regression coverage in `api/__tests__/feedRatingEventDedup.test.js`, `api/__tests__/ratingsController.test.js`, `api/__tests__/feedController.mergeCheckinRatingPairs.test.js`, and `api/__tests__/shelvesController.test.js`.
- 2026-03-25 | manual-detail-fields | Updated `mobile/src/screens/CollectableDetailScreen.js` to explicitly surface manual-editable metadata fields only when populated, separate `Your Notes` from description rendering, and refresh manual details on focus via `/api/manuals/:manualId`; updated `api/controllers/shelvesController.updateManualEntry` to normalize nullable manual edits (`null`/blank stay null) and validate `year` as 1-4 digits so empty fields remain hidden in detail metadata.
- 2026-03-25 | shelves-top-create-cta | Updated `mobile/src/screens/ShelvesScreen.js` so My Shelves renders an additional top-of-list `New Shelf` CTA once shelf count exceeds 6 (when not searching), while retaining the existing in-list create card for parity with current creation flow.
- 2026-03-25 | vision-progress-other-modal | Improved `other` shelf scan progress UX by adding new progress config stages in `api/config/visionProgressMessages.json` (`extractingSecondPass`, `matchingOther`, `reviewingOther`), updating `VisionPipelineService.processImage()` to emit these monotonic statuses during second-pass/duplicate-review flow, and extending `api/__tests__/visionPipeline.test.js` with coverage asserting second-pass progress no longer regresses to the 10% extracting stage.
- 2026-03-25 | other-shelf-description-validation | Enforced non-empty descriptions for `other` shelves across mobile + API: `ShelfCreateScreen`/`ShelfEditScreen` now require description text for `other`; `shelvesController.createShelf` and `updateShelf` reject blank descriptions when shelf type is `other`; and `processShelfVision` + `processCatalogLookup` now return 400 for legacy `other` shelves without description so Gemini prompts are not run with empty shelf context.
- 2026-03-25 | add-to-shelf-navigation-workflow | Updated `mobile/src/screens/ShelfSelectScreen.js` to use `navigation.replace()` for both existing-shelf and create-shelf paths in the Add-to-Shelf workflow, removing `ShelfSelect` from the stack once a shelf destination is chosen so back-navigation from `ShelfDetail` no longer returns users to `Choose Shelf` after adding items.
- 2026-03-25 | shelf-detail-cache-refresh | Updated `mobile/src/screens/ShelfDetailScreen.js` to use cached-first shelf detail reload behavior: initial load remains blocking, focus-triggered reloads now run non-blocking via `useFocusEffect` + `InteractionManager.runAfterInteractions`, concurrent shelf fetches are deduped with an in-flight guard, and shelf state reset is scoped to shelf-id changes to prevent swipe-back flicker/rebuild artifacts when returning from `CollectableDetail`.
- 2026-03-25 | shelf-edit-cache-refresh | Updated `mobile/src/screens/ShelfEditScreen.js` with cached-first shelf hydration so initial navigation with route shelf data avoids blocking spinner, added non-blocking focus refresh via `useFocusEffect` + `InteractionManager.runAfterInteractions` for swipe-back smoothness, and deduped concurrent shelf fetches with an in-flight guard.
- 2026-03-24 | vision-crops-linking | Hardened scan crop attachment against save-order drift by adding `vision_item_regions.collection_item_id` (migration `20260324001000_add_collection_item_id_to_vision_item_regions` + init schema update), wiring `VisionPipeline` to persist per-region `user_collections.id` links during collectable/manual save paths, and updating crop warmup attach flow to resolve exact `collection_item_id` first with legacy collectable/manual fallback.
- 2026-03-25 | search-normalization | Added accent-insensitive hybrid item search matching (raw + normalized OR) without DB extensions by introducing shared API normalization helper (`api/utils/searchNormalization.js`) and applying it to `collectables` query search functions (`searchByTitle`, `searchGlobal`, `searchGlobalWildcard`, `fuzzyMatch`), `/api/checkin/search` SQL, and `/api/collectables` count queries. Added mobile-side normalization helper (`mobile/src/utils/searchNormalization.js`) for local item filtering in `ShelfDetailScreen` and `WishlistScreen`, and corrected `ListDetailScreen` add-item lookup route to `/api/collectables`.
- 2026-03-24 | vision-drift-prevention | Implemented future-only drift/duplicate prevention for large vision scans: `VisionPipeline` now carries immutable source identity (`scanPhotoId + extractionIndex`) across all save phases with run-level dedupe, applies strict enrichment-to-unresolved index mapping, enforces strict movie/tv fallback matching gates from `visionSettings.json` (`candidateLimit`, similarity/token/coverage/margin thresholds), uses first-region-wins crop linking per `collection_item_id` (with duplicate link skip + lower-index replacement), disables repeated region-link update attempts after first missing-column schema failure, exposes explicit save counters (`attemptedSaves`, `savedUniqueRegions`, `duplicateSourceSkipped`, `duplicateRegionLinkSkipped`), and guards crop attach in `shelvesController` so non-winning duplicate regions cannot overwrite owner photo assignments.
- 2026-03-23 | owner-photo-cropper | Replaced static edit buttons with gesture-based ImageCropper component in CollectableDetailScreen. Features include main crop pan/zoom, interactive dial rotation, and a discrete 3:4 thumbnail picker that saves normalized coordinates directly to the backend endpoint PUT /owner-photo/thumbnail.
- 2026-03-24 | mobile-keyboard-stability | Mitigated iOS UIKit runloop keyboard hangs tied to profile/onboarding text entry: `App.js` now avoids wrapping iOS navigation in a global `KeyboardAvoidingView` (Android-only wrapper retained), `ProfileScreen` now prevents async profile refresh from overwriting active edits and adds keyboard-stable city/state/country input behavior, and `OnboardingProfileRequiredScreen` now guards against late `/api/account` hydration clobbering in-progress form typing while adding explicit iOS-friendly city/state text input focus flow.
- 2026-03-24 | vision-crops | Added env-configurable Gemini bbox persistence padding (`VISION_BBOX_PADDING_X_PX`, `VISION_BBOX_PADDING_Y_PX`) in `VisionPipelineService.persistVisionRegions()` so future stored `vision_item_regions.box_2d` values include more real estate, while leaving extraction-time crop math unchanged (no double-padding).
- 2026-03-24 | vision-workflow | Added env-tunable Gemini thinking budgets for `other` shelf extraction (`VISION_OTHER_FIRST_PASS_THINKING_BUDGET`, `VISION_OTHER_SECOND_PASS_THINKING_BUDGET`) and implemented automatic second-pass retry for low-confidence `other` detections with extractionIndex-based merge + recategorization before review/manual routing.
- 2026-03-24 | vision-stability | Stabilized vision save/enrichment pipeline: fixed `collectables.upsert` JSON parameter binding order for `identifiers`/`market_value`/`market_value_sources`, added one-shot Gemini confidence patch retry when extraction confidence is omitted (merge by `extractionIndex`), added explicit OCR vs enrichment stage logs, and changed `VisionPipeline.saveToShelf()` to route per-item save failures to `needs_review` with `reason: save_error` while preserving successful items.
- 2026-03-24 | vision-enrichment-prompts | Fixed enrichment prompt routing for vinyl/music: `resolveVisionCategory()` now maps `vinyl` (and record aliases) to `music`, preventing fallback to book instructions; enrichment schema hint block is now category-aware so music/vinyl prompts use UPC/Discogs/MusicBrainz and vinyl format language instead of book-centric examples.
- 2026-03-24 | owner-photo-thumbnails | Added centered 2/3 thumbnail auto-box default for `vision_crop` owner photos when no explicit thumbnail box exists; upload-source auto thumbnails remain full-frame default and explicit `PUT /owner-photo/thumbnail` boxes still take precedence.
- 2026-03-23 | owner-photo-cropper | Fixed false crop save-boundary failures at higher zoom: `ImageCropper` transform order now applies pan translation after scale/rotation, aligning runtime gesture transforms with `CollectableDetailScreen` save math so visible in-bounds crops no longer resolve to out-of-bounds on save.
- 2026-03-23 | owner-photo-cropper | Added dev-only structured crop diagnostics in `ImageCropper` + `CollectableDetailScreen` for save failures: logs now include emitted gesture payload, derived scale/crop rect, rotated dimensions, valid bounds, clipped safe rect, and failure stage under `[OwnerPhotoCropDebug]`.
- 2026-03-23 | owner-photo-cropper | Fixed fit-scale desync between crop preview and save math: `ImageCropper` now applies `initialImgScale` inside the animated transform stack and includes `displayBaseScale` in save payload; `CollectableDetailScreen` consumes that exact base scale (fallback to derived) for crop rectangle computation.
- 2026-03-23 | owner-photo-cropper | Corrected remaining crop-position drift after save by reordering `ImageCropper` transforms to keep pan in unscaled screen-space (`translate -> scale -> rotate`), matching `CollectableDetailScreen` inverse crop math (`translate / finalScale`) and preventing bottom-strip crops from centered selections.
- 2026-03-23 | shelf-detail-ui | Shelf list cards now prefer owner-photo thumbnail for manual `other` items using `item.ownerPhoto.thumbnailImageUrl` with `thumbnailUpdatedAt`/`updatedAt` cache-busting (`?v=...`) in `ShelfDetailScreen`, so thumbnail edits appear immediately after returning from detail view.
- 2026-03-23 | shelf-detail-ui | Fixed blank shelf thumbnails after switching to owner-photo sources: `ShelfDetailScreen` now passes auth headers for private owner-photo image/thumbnail endpoints and falls back to primary owner-photo image when a generated thumb is not yet present; `CachedImage` now resets its internal error state when `source` changes so prior load failures don't persist as blank tiles.
- 2026-03-23 | shelf-detail-ui | Updated owner-photo thumb selection to always request `thumbnailImageUrl` first for manual `other` list cards (with auth headers), allowing backend lazy thumbnail generation to run even when `thumbnailUpdatedAt` metadata is not yet populated.
- 2026-03-23 | auth-tooling | Added PowerShell helper `api/scripts/get-bearer-token.ps1` to authenticate against `/api/auth/login` (with `/api/login` fallback), print token or `Bearer <token>`, and optionally copy to clipboard for local API testing.
- 2026-03-23 | auth-tooling | Added PowerShell helper `api/scripts/fetch-api-payload.ps1` to call authenticated API endpoints using a bearer token (param/env/clipboard), with method/body support plus raw/pretty output and optional response file save.
- 2026-03-23 | vision-crops | Hardened vision bbox handling and scan-region persistence: added shared normalizer `utils/visionBox2d.js` used by `googleGemini`, `visionPipeline`, and `visionCropper`; `processShelfVision` now passes scan dimensions into pipeline options; `visionPipeline.persistVisionRegions()` auto-repairs absolute bbox coordinates when dimensions are known, rejects invalid boxes, logs repair/reject counts, and calls `visionItemRegions.upsertRegionsForScan(..., replaceExisting: true)` for per-scan snapshot replacement before crop warmup.
- 2026-03-22 | vision-workflow | Added explicit vision completion contract fields across API and mobile consumption: `addedCount`, `needsReviewCount`, `existingCount`, `extractedCount`, `summaryMessage`; documented sync, async status, and catalog lookup payload expectations.
- 2026-03-23 | vision-workflow | Joined enrichment requests to original Gemini vision extraction using multi-turn chat sessions (`startChat`/`sendMessage`). `detectShelfItemsFromImage()` now returns `{ items, conversationHistory }`. `enrichWithSchema()` and `enrichWithSchemaUncertain()` accept optional `conversationHistory` param — when provided and vision/text models match, enrichment continues the chat session (image context preserved). "Other" shelf search enrichment also uses chat mode. New private helper `_executeEnrichmentRequest()` handles chat-vs-standalone branching. `visionPipeline.js` threads `conversationHistory` from `extractItems()` through `processImage()` to both enrichment calls. Fully backward-compatible (MLKit rawItems path, model mismatch, enrichment disabled all fall back to standalone mode).
- 2026-03-23 | vision-workflow | Consolidated "other" shelf vision pipeline from 2 Gemini calls to 1. `detectShelfItemsFromImage()` now passes `tools: [{ googleSearch: {} }]` on the vision `generateContent` call for "other" shelves, getting full metadata + search grounding in a single request. Removed the separate Step 2 search enrichment block and the `other_initial` prompt from `visionSettings.json`. Conversation history is now returned for all shelf types including "other".
- 2026-03-23 | vision-workflow | Added Gemini 2.5 thinking budget control to `detectShelfItemsFromImage()`: `thinkingBudget: 0` for standard shelf OCR (pure perception, no reasoning cost), `thinkingBudget: 3000` for "other" shelves (search grounding + reasoning). Enrichment calls (`_executeEnrichmentRequest`) use default/unlimited thinking. Also bumped `DEFAULT_REQUEST_TIMEOUT_MS` from 10s to 60s and passed `requestOptions: { timeout }` to SDK `getGenerativeModel()` for proper fetch-level `AbortController` timeout.
- 2026-03-23 | vision-workflow | Hardened vision extraction failure handling: `detectShelfItemsFromImage()` now throws on Gemini transport/provider failures (instead of returning empty `items`), repairs truncated JSON arrays when possible, and returns an extraction warning for partial recovery. `VisionPipelineService.processImage()` now carries extraction warnings into the existing `warnings` response payload.
- 2026-03-23 | vision-workflow | Added match observability logs in `VisionPipelineService`: when extracted items resolve to existing records, logs now include `sourceTable` and `sourceId` for `collectables` and `user_manuals` matches (plus `collectionId` for `user_collections` manual links).
- 2026-03-23 | api-logging | Disabled request-level HTTP logging middleware in `api/server.js` (removed `middleware/requestLogger` mount). GET/POST request console logs and request-driven writes to `job_runs`/`job_events` are no longer emitted by default request handling.
- 2026-03-23 | workflow-job-context | Added `middleware/workflowJobContext.js` and mounted it for workflow POST routes (`/api/shelves/:shelfId/vision`, `/api/shelves/:shelfId/catalog-lookup`) to auto-assign request job IDs via AsyncLocalStorage without restoring global request DB logging.
- 2026-03-23 | market-value | Added `market_value` + `market_value_sources` schema support on `collectables` and `user_manuals` (new migration `20260323020000_add_market_value_to_collectables_and_user_manuals` + init schema update). Wired Gemini prompts/schema parsing to request market value with source links, persisted values in vision/manual/collectable save flows, and intentionally omitted `marketValueSources` from API response payloads for now.
- 2026-03-23 | other-shelf-dedupe | Hardened "other" manual matching with canonical normalization + barcode + conservative fuzzy matching (`fuzzy_auto`/`fuzzy_review`), added in-scan dedupe (`barcode` -> `manualFingerprint` -> canonical title+creator), and routed borderline matches to `needs_review` as `possible_duplicate`. Applied to both `VisionPipelineService` and review completion flows (`controllers/shelvesController.js`, `routes/unmatched.js`).
- 2026-03-23 | vision-idempotency | Added persistent image-result cache for `POST /api/shelves/:shelfId/vision` (`database/queries/visionResultCache.js`, migration `20260323040000_create_vision_result_cache`). Controller now hashes image bytes, logs cache hit/miss, short-circuits sync/async cache hits, and stores successful uncached pipeline results with TTL.
- 2026-03-23 | vision-scan-photos | Added private vision scan persistence + region linking: new tables `vision_scan_photos` and `vision_item_regions` with RLS, new query modules `database/queries/visionScanPhotos.js` and `database/queries/visionItemRegions.js`, `VisionPipelineService` propagation/linking for `box2d` + `extractionIndex`, and authenticated scan endpoints (`GET /api/shelves/:shelfId/vision/scans/:scanPhotoId`, `/image`, `/regions`). `POST /api/shelves/:shelfId/vision` now accepts `imageBase64` or `rawItems` at route-validation layer and returns `scanPhotoId` in sync/async/cached responses.
- 2026-03-23 | vision-crops | Implemented Phase 2 crop generation with lazy private artifacts: added `vision_item_crops` table + RLS, new query module `database/queries/visionItemCrops.js`, new `services/visionCropper.js` (`sharp`-based crop extraction), and authenticated crop endpoint `GET /api/shelves/:shelfId/vision/scans/:scanPhotoId/regions/:regionId/crop`. Region list payload now includes `hasCrop` and `cropImageUrl` metadata.
- 2026-03-23 | vision-crops | Added end-of-workflow crop warmup hook in `processShelfVision`: after successful pipeline completion, backend now queues best-effort generation of missing region crops for the scan (same crop logic as region-crop GET endpoint) via `warmVisionScanCrops`, with env controls `VISION_CROP_WARMUP_ENABLED` and `VISION_CROP_WARMUP_MAX_REGIONS`.
- 2026-03-23 | owner-photo-secondary | Added secondary owner photo attachments on `user_collections` (new migration `20260323070000_add_owner_photo_secondary_media` + init schema updates) and global profile flag `users.show_personal_photos`. Added authenticated shelf-item endpoints: `GET /api/shelves/:shelfId/items/:itemId/owner-photo`, `GET /image`, `PUT /visibility`, `POST /owner-photo` (upload). Crop generation now auto-attaches vision crops to matching shelf items without changing primary cover fields; mobile `CollectableDetailScreen` now renders a new "Your photo" section with upload/replace + visibility toggle and `ProfileScreen` adds "Show Personal Photos" setting.
- 2026-03-23 | owner-photo-secondary | Added owner-photo deletion flow: new authenticated endpoint `DELETE /api/shelves/:shelfId/items/:itemId/owner-photo`, query helper `clearOwnerPhotoForItem()` (clears `user_collections.owner_photo_*` and deletes stored upload asset when applicable), and mobile `CollectableDetailScreen` black `X` affordance with confirmation modal.
- 2026-03-23 | owner-photo-thumbnails | Added persisted owner-photo thumbnail variant support (fixed 3:4 render, default 300x400): new migration `20260323110000_add_owner_photo_thumbnail_variant`, new service `services/ownerPhotoThumbnail.js`, `user_collections.owner_photo_thumb_*` fields + `owner_photo_thumb_box_check`, route endpoints `GET /api/shelves/:shelfId/items/:itemId/owner-photo/thumbnail` and `PUT /api/shelves/:shelfId/items/:itemId/owner-photo/thumbnail`, and lazy thumbnail generation/persistence in `database/queries/userCollectionPhotos.js`.
- 2026-03-23 | owner-photo-thumbnails | Fixed migration SQL portability bug in `20260323110000_add_owner_photo_thumbnail_variant`: replaced JSONB key-existence operator checks (`?`) with `jsonb_exists(...)` to prevent Knex placeholder substitution (`$1/$2`) and migration failure; mirrored fix in init schema constraint.
- 2026-03-23 | collectable-detail-ui | Fixed manual/other owner-photo hero behavior: `CollectableDetailScreen` now keeps hero replacement active for `other` manual items whenever an owner photo exists (not only when `source === 'vision_crop'`), preventing duplicate cover + "Your photos" display after photo edits switch source to `upload`.
- 2026-03-23 | collectable-detail-ui | Updated owner-photo viewer flow to view-first mode: tapping photo now opens a read-only full-image viewer, with owner-only `Edit` action that explicitly enters `ImageCropper`; cropper cancel now returns to viewer mode instead of closing the modal.
- 2026-03-23 | collectable-detail-ui | Safe-area hardening for owner-photo modal/editor on iOS: owner photo modal now uses full-screen presentation with `SafeAreaView` on all edges, and `ImageCropper` now uses live `useWindowDimensions()` sizing instead of static `Dimensions` constants to avoid overflow past safe zones.
- 2026-03-23 | collectable-detail-ui | Further iOS overflow fix in `ImageCropper`: crop viewport/image centering now uses measured `imageContainer` layout (`onLayout`) rather than global window constants, preventing editor content from extending beyond safe bounds on notched devices.
- 2026-03-23 | collectable-detail-ui | Additional safe-zone fix for owner photo modal: read-only viewer now applies explicit `insets` padding at modal root, and `ImageCropper` accepts `forcedInsets` from parent to guarantee notch/home-indicator spacing even when modal safe-area context is inconsistent.
- 2026-03-23 | collectable-detail-ui | Fixed owner photo edit save failures for free-angle rotation: `CollectableDetailScreen` now performs two-step rotate-then-crop using measured rotated output dimensions, restores missing crop size calculations (`cropW`/`cropH`), clamps crop to valid bounds (with inscribed-rect protection for rotated images), validates thumbnail boxes before PUT, and surfaces concrete save/thumbnail errors. `ImageCropper` now returns actual crop-window `viewSize` for consistent math.
- 2026-03-23 | collectable-detail-ui | Expanded `CollectableDetailScreen` owner-photo UX: safe-area aware full-screen viewer, in-view editing tools (preset crops, rotate, reset, save), cache-busting via `ownerPhoto.updatedAt`, conditional auto-scan subtitle (`source === 'vision_crop'` only), manual hero replacement with owner photo for crop-backed manual items, and collectable hero-centered owner-photo placement/alignment refinements.
- 2026-03-23 | db-tooling | Added `api/scripts/pgrewind.js` and `npm run pgrewind` for local-only rewind testing: deletes rows with `created_at >= now - --hours`, supports `--dry-run`, hardcodes `localhost:5432/shelvesai` + user `shelves`, and performs runtime safety checks to block non-local targets.
- 2026-03-23 | vision-upload-limits | Raised private vision scan photo validation limits for modern phones: `visionScanPhotos.upsertFromBuffer()` now validates with `VISION_SCAN_MAX_DIMENSION` (default `8192`) and `VISION_SCAN_MAX_PIXELS` (default `40000000`) instead of the global 4096 cap. Added area-check support in `utils/imageValidation.js`, new unit tests (`__tests__/imageValidation.test.js`), and documented env knobs in `.env.local.example`.
- 2026-03-22 | dev-workflow | Added `npm run dev:local` scripts to both `api/` and `mobile/` for fully local development. API: `server.js` now loads `.env.local` overrides (highest priority); `database/pg.js` uses development defaults matching `knexfile.js` (localhost/shelves/localdev123/shelvesai); added `cross-env` devDep. Mobile: new `scripts/dev-local.js` reads `LOCAL_API_ADDRESS` from `.env.local` (default `http://localhost:5001`), sets `EXPO_PUBLIC_API_BASE`, spawns Expo; `app.config.js` accepts `LOCAL_API_ADDRESS` as fallback for `API_BASE`. New files: `api/.env.local.example`, `mobile/.env.local.example`, root `.env.local.example`.

---

## Cross-Component Dependencies

### API ↔ Mobile Contract

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

### API ↔ Admin Dashboard Contract

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

### API ↔ Website Contract

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
  → api/server.js
  -> api/logger.js
  → api/database/pg.js
  → api/services/newsCacheScheduler.js
  → api/services/newsSeenCleanupScheduler.js

api/server.js
  → api/routes/resetPasswordPage.js
  → api/routes/auth.js
  → api/routes/shelves.js
  → api/routes/account.js
  → api/routes/collectables.js
  → api/routes/feed.js
  → api/routes/friends.js
  → api/routes/profile.js
  → api/routes/wishlists.js
  → api/routes/favorites.js
  → api/routes/lists.js
  → api/routes/unmatched.js
  → api/routes/onboarding.js
  → api/routes/config.js
  → api/routes/checkin.js
  → api/routes/notifications.js
  → api/routes/ratings.js
  → api/routes/discover.js
  → api/routes/push.js
  → api/routes/admin.js
  → api/routes/manuals.js
  → api/routes/waitlist.js
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

### Routes → Controllers → Queries/Services

#### auth
```
routes/auth.js
  → controllers/authController.js
  → middleware/auth.js
  → middleware/validate.js

controllers/authController.js
  → database/queries/auth.js
  → database/queries/passwordReset.js
  → services/emailService.js
  → utils/adminAuth.js
```

#### shelves
```
routes/shelves.js
  -> includes POST /:shelfId/items/:itemId/replacement-intent and POST /:shelfId/items/:itemId/replace
  → controllers/shelvesController.js
  → middleware/auth.js
  → middleware/validate.js
  -> middleware/workflowJobContext.js (vision/catalog workflow routes only)
  → utils/imageValidation.js

controllers/shelvesController.js
  -> database/queries/itemReplacementTraces.js
  → database/pg.js
  → database/queries/shelves.js
  → database/queries/collectables.js
  → database/queries/feed.js
  → database/queries/utils.js
  → database/queries/needsReview.js
  -> database/queries/visionQuota.js
  -> database/queries/visionResultCache.js
  → database/queries/manualMedia.js
  -> database/queries/userCollectionPhotos.js
  -> database/queries/visionScanPhotos.js
  -> database/queries/visionItemRegions.js
  -> database/queries/visionItemCrops.js
  → services/collectables/fingerprint.js
  → services/collectableMatchingService.js
  → services/catalog/BookCatalogService.js
  → services/catalog/MovieCatalogService.js
  → services/catalog/GameCatalogService.js
  → services/visionPipeline.js
  → services/visionPipelineHooks.js
  -> services/visionCropper.js
  → services/processingStatus.js
  → services/mediaUrl.js
  → services/manuals/otherManual.js
  → utils/imageValidation.js
  → utils/normalize.js
  → config/constants.js
```

#### feed
```
routes/feed.js
  → controllers/feedController.js
  → controllers/eventSocialController.js
  → middleware/auth.js
  → middleware/validate.js

controllers/feedController.js
  → database/pg.js
  → database/queries/feed.js
  → database/queries/shelves.js
  → database/queries/friendships.js
  → database/queries/eventSocial.js
  → database/queries/newsSeen.js
  → database/queries/utils.js
  → services/discovery/newsRecommendations.js
  → services/mediaUrl.js
  → config/constants.js

controllers/eventSocialController.js
  → database/queries/eventSocial.js
  → database/queries/notifications.js
  → database/queries/utils.js
```

#### friends
```
routes/friends.js
  → controllers/friendController.js
  → middleware/auth.js
  → middleware/validate.js

controllers/friendController.js
  → database/pg.js
  → database/queries/friendships.js
  → database/queries/notifications.js
  → database/queries/utils.js
  → services/mediaUrl.js
```

#### profile
```
routes/profile.js
  → controllers/profileController.js
  → middleware/auth.js
  → middleware/validate.js
  → utils/imageValidation.js

controllers/profileController.js
  → database/pg.js
  → database/queries/users.js
  → database/queries/shelves.js
  → database/queries/profileMedia.js
  → database/queries/utils.js
  → services/mediaUrl.js
  → utils/imageValidation.js
```

#### account
```
routes/account.js
  → controllers/accountController.js
  → middleware/auth.js

controllers/accountController.js
  → database/pg.js
  → database/queries/utils.js
  → database/queries/visionQuota.js
  → services/mediaUrl.js
  Guards: checks req.user.premiumLockedByAdmin before allowing is_premium update
```

#### collectables
```
routes/collectables.js
  → middleware/auth.js
  → middleware/admin.js
  → middleware/validate.js
  → database/queries/collectables.js
  → database/pg.js
  → database/queries/utils.js
  → services/collectables/fingerprint.js
  → services/collectables/kind.js
  → utils/normalize.js
  →database/queries/marketValueEstimates.js
  Endpoints: GET /:collectableId/market-value-sources, GET /:collectableId/user-estimate, PUT /:collectableId/user-estimate
```

#### wishlists
```
routes/wishlists.js
  → controllers/wishlistController.js
  → middleware/auth.js
  → middleware/validate.js

controllers/wishlistController.js
  → database/queries/wishlists.js
```

#### favorites
```
routes/favorites.js
  → controllers/favoritesController.js
  → middleware/auth.js
  → middleware/validate.js

controllers/favoritesController.js
  → database/queries/favorites.js
  → database/queries/collectables.js
  → database/queries/feed.js
  → database/queries/users.js
  → database/queries/friendships.js
  → database/queries/shelves.js
  → services/mediaUrl.js
  → utils/errorHandler.js
```

#### lists
```
routes/lists.js
  → controllers/listsController.js
  → middleware/auth.js
  → middleware/validate.js

controllers/listsController.js
  → database/queries/lists.js
  → database/queries/collectables.js
  → database/queries/feed.js
```

#### ratings
```
routes/ratings.js
  → controllers/ratingsController.js
  → middleware/auth.js
  → middleware/validate.js

controllers/ratingsController.js
  → database/queries/ratings.js
  → database/queries/marketValueEstimates.js
  → database/queries/collectables.js
  → database/queries/shelves.js
  → database/queries/feed.js
  → services/mediaUrl.js
```

#### notifications
```
routes/notifications.js
  → controllers/notificationController.js
  → middleware/auth.js
  → middleware/validate.js

controllers/notificationController.js
  → database/queries/notifications.js
  → database/queries/utils.js
```

#### push
```
routes/push.js
  → controllers/pushController.js
  → middleware/auth.js

controllers/pushController.js
  → database/queries/pushDeviceTokens.js
  → database/queries/notificationPreferences.js
  → services/pushNotificationService.js
```

#### discover
```
routes/discover.js
  → controllers/discoverController.js
  → middleware/auth.js

controllers/discoverController.js
  → database/pg.js
  → database/queries/newsDismissed.js
  → database/queries/utils.js
  → utils/errorHandler.js
```

#### unmatched
```
routes/unmatched.js
  → middleware/auth.js
  → middleware/validate.js
  → database/queries/needsReview.js
  → database/queries/shelves.js
  → database/queries/collectables.js
  → services/collectables/fingerprint.js
  → services/manuals/otherManual.js
  → services/collectableMatchingService.js (lazy require)
```

#### checkin
```
routes/checkin.js
  → middleware/auth.js
  → middleware/validate.js
  → database/queries/feed.js
  → database/queries/collectables.js
  → database/pg.js
  → database/queries/utils.js
```

#### onboarding
```
routes/onboarding.js
  → controllers/onboardingController.js
  → middleware/auth.js

controllers/onboardingController.js
  → database/queries/users.js
  → database/queries/utils.js
```

#### admin
```
routes/admin.js
  → controllers/adminController.js
  → controllers/authController.js
  → middleware/auth.js
  → middleware/admin.js
  → middleware/csrf.js
  → middleware/validate.js
  Routes (read, before CSRF):
    GET  /stats, /stats/detailed, /users, /feed/recent, /jobs, /jobs/:jobId
    GET  /settings, /users/:userId/vision-quota, /audit-logs
    GET  /shelves, /shelves/:shelfId, /shelves/:shelfId/items
  Routes (write, after CSRF):
    PUT  /settings/:key, /users/:userId/vision-quota
    POST /users/:userId/suspend, /unsuspend, /toggle-admin, /toggle-premium
    POST /users/:userId/vision-quota/reset

controllers/adminController.js
  → database/queries/admin.js
  → database/queries/jobRuns.js
  → database/queries/systemSettings.js
  → database/queries/visionQuota.js
  → database/queries/adminContent.js
  → services/config/SystemSettingsCache.js
  → database/queries/utils.js
  → utils/adminAuth.js
```

#### manuals
```
routes/manuals.js
  → controllers/shelvesController.js
  → middleware/auth.js
  → middleware/validate.js
```

#### config
```
routes/config.js
  (reads config/onboardingScreen.json via fs)
```

#### waitlist
```
routes/waitlist.js
  → middleware/validate.js
  → resend (Contacts API)
```

#### resetPasswordPage
```
routes/resetPasswordPage.js
  (no internal imports — serves reset-password web fallback + app deep-link bridge)
```

### Middleware Internal Dependencies

```
middleware/auth.js
  → database/pg.js
  -> context.js
  → utils/adminAuth.js
  → config/constants.js
  Selects: is_premium, premium_locked_by_admin → sets req.user.premiumLockedByAdmin

middleware/admin.js
  (no internal imports)

middleware/validate.js
  (no internal imports)

middleware/csrf.js
  → utils/adminAuth.js

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
  → services/googleGemini.js
  → services/processingStatus.js
  → services/visionPipelineHooks.js
  → services/collectables/fingerprint.js
  → services/collectables/kind.js
  → services/catalog/BookCatalogService.js
  → services/catalog/MovieCatalogService.js
  → services/catalog/GameCatalogService.js
  → services/catalog/TvCatalogService.js
  → services/catalog/MusicCatalogService.js
  → services/manuals/otherManual.js
  → database/pg.js
  → database/queries/collectables.js
  → database/queries/shelves.js
  → database/queries/needsReview.js
  → database/queries/feed.js
  -> database/queries/visionItemRegions.js
  → config/constants.js
  → config/visionSettings.json
  -> utils/visionBox2d.js
  Data flow: extractItems() -> { items, conversationHistory, warning }
             processImage() threads conversationHistory to enrichUnresolved/enrichUncertain
             processImage() appends extraction warning to `warnings` payload when present
             processImage(options.scanPhotoDimensions) normalizes/repairs bbox before persistence
             persistVisionRegions(...) uses replaceExisting snapshot semantics per scanPhotoId

services/visionPipelineHooks.js
  (no internal imports — hook registry)

services/processingStatus.js
  (no internal imports — in-memory Map)

services/googleGemini.js
  → config/visionSettings.json
  -> utils/visionBox2d.js
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
  (no internal imports — disabled)

services/visionCropper.js
  -> utils/visionBox2d.js
  Uses shared bbox normalization for crop rectangle repair/clamping (normalized + absolute-style coords)

services/collectableMatchingService.js
  → database/queries/collectables.js
  → services/collectables/fingerprint.js
  → services/catalog/BookCatalogService.js
  → services/catalog/MovieCatalogService.js
  → services/catalog/GameCatalogService.js
  → services/catalog/TvCatalogService.js
  → services/catalog/MusicCatalogService.js

services/collectables/fingerprint.js
  (no internal imports — crypto hashing)

services/collectables/kind.js
  → services/config/shelfTypeResolver.js

services/config/shelfTypeResolver.js
  → config/shelfType.json

services/catalog/BookCatalogService.js
  → services/catalog/CatalogRouter.js
  → services/openLibrary.js
  → services/hardcover.js
  → adapters/openlibrary.adapter.js
  → adapters/hardcover.adapter.js

services/catalog/MovieCatalogService.js
  → services/catalog/CatalogRouter.js
  → services/catalog/adapters/TmdbAdapter.js

services/catalog/GameCatalogService.js
  → services/catalog/CatalogRouter.js
  → services/catalog/adapters/IgdbAdapter.js

services/catalog/TvCatalogService.js
  → services/catalog/CatalogRouter.js
  → services/catalog/adapters/TmdbTvAdapter.js

services/catalog/MusicCatalogService.js
  → services/collectables/fingerprint.js
  → adapters/musicbrainz.adapter.js
  → services/config/shelfTypeResolver.js
  → services/catalog/MusicBrainzRequestQueue.js
  → services/catalog/CatalogRouter.js (lazy require)

services/catalog/MusicBrainzRequestQueue.js
  (no internal imports — FIFO request queue)

services/catalog/CoverArtBackfillHook.js
  → services/visionPipelineHooks.js (lazy require in register())

services/catalog/CatalogRouter.js
  → config/apiContainers.json
  → services/catalog/MetadataScorer.js

services/catalog/MetadataScorer.js
  → config/metadataScoreConfig.json
  → services/config/SystemSettingsCache.js

services/catalog/metadataScore.js
  → services/catalog/MetadataScorer.js

services/config/SystemSettingsCache.js
  → database/queries/systemSettings.js (lazy require, cache miss only)

services/catalog/adapters/TmdbAdapter.js
  → utils/RateLimiter.js

services/catalog/adapters/TmdbTvAdapter.js
  → utils/RateLimiter.js

services/catalog/adapters/IgdbAdapter.js
  → utils/RateLimiter.js

services/catalog/adapters/MusicBrainzAdapter.js
  → services/collectables/fingerprint.js
  → adapters/musicbrainz.adapter.js
  → utils/withTimeout.js
  → services/catalog/MusicCatalogService.js (lazy require)

services/catalog/adapters/DiscogsAdapter.js
  → services/collectables/fingerprint.js
  → adapters/discogs.adapter.js
  → utils/withTimeout.js
  → utils/RateLimiter.js

services/openLibrary.js
  → utils/RateLimiter.js

services/hardcover.js
  → utils/RateLimiter.js

services/emailService.js
  (no internal imports — uses resend)

services/pushNotificationService.js
  (no internal imports — uses expo-server-sdk)

services/s3.js
  (no internal imports — uses @aws-sdk/client-s3)

services/mediaUrl.js
  (no internal imports)

services/manuals/otherManual.js
  (no internal imports)

services/newsCacheScheduler.js
  → jobs/refreshNewsCache.js
  -> utils/jobRunner.js

services/newsSeenCleanupScheduler.js
  → database/queries/newsSeen.js
  -> utils/jobRunner.js

services/discovery/newsRecommendations.js
  → database/pg.js
  → database/queries/newsSeen.js

services/discovery/CollectableDiscoveryHook.js
  → database/queries/collectables.js
  → services/collectables/fingerprint.js

services/discovery/TmdbDiscoveryAdapter.js
  → utils/RateLimiter.js

services/discovery/IgdbDiscoveryAdapter.js
  → utils/RateLimiter.js

services/discovery/BlurayDiscoveryAdapter.js
  (uses cheerio for scraping)

services/discovery/NytBooksDiscoveryAdapter.js
  (no internal imports)
```

### Jobs Internal Dependencies

```
jobs/refreshNewsCache.js
  → services/discovery/TmdbDiscoveryAdapter.js
  → services/discovery/IgdbDiscoveryAdapter.js
  → services/discovery/BlurayDiscoveryAdapter.js
  → services/discovery/NytBooksDiscoveryAdapter.js
  → database/pg.js

jobs/resetAndRefreshNewsCache.js
  → jobs/refreshNewsCache.js

jobs/refreshCollectableMetadata.js
  → services/catalog/* (catalog services)

jobs/refreshTmdbCoverCache.js
  → services/s3.js

jobs/cleanupNeedsReview.js
  → database/pg.js
```

### Scripts Internal Dependencies

```
scripts/backfillMetascore.js
  → database/pg.js
  → services/catalog/MetadataScorer.js
  → services/config/shelfTypeResolver.js
  → database/queries/utils.js

scripts/backfill-missing-cover-media.js
  → database/pg.js
  → database/queries/media.js
  → logger.js

scripts/get-bearer-token.ps1
  (standalone PowerShell HTTP client for local auth token retrieval)

scripts/fetch-api-payload.ps1
  (standalone PowerShell HTTP client for authenticated API payload retrieval)
```

### Database Query Dependencies

```
database/pg.js
  (no internal imports — pg Pool singleton)

database/queries/utils.js
  (no internal imports — pure helpers)

database/queries/auth.js → database/pg.js, database/queries/utils.js
database/queries/shelves.js → database/pg.js, database/queries/utils.js
database/queries/itemReplacementTraces.js -> database/pg.js, database/queries/utils.js
database/queries/collectables.js → database/pg.js, database/queries/utils.js, database/queries/media.js, services/collectables/kind.js, database/queries/jobRuns.js, context.js
database/queries/feed.js → database/pg.js, database/queries/utils.js, config/constants.js
database/queries/eventSocial.js → database/pg.js, database/queries/utils.js
database/queries/friendships.js → database/pg.js, database/queries/utils.js
database/queries/users.js → database/pg.js, database/queries/utils.js
database/queries/notifications.js → database/pg.js, database/queries/utils.js
database/queries/needsReview.js → database/pg.js, database/queries/utils.js
database/queries/wishlists.js → database/pg.js, database/queries/utils.js
database/queries/favorites.js → database/pg.js, database/queries/utils.js
database/queries/lists.js → database/pg.js, database/queries/utils.js
database/queries/ratings.js → database/pg.js, database/queries/utils.js
database/queries/ownership.js → database/pg.js
database/queries/media.js → database/pg.js, services/s3.js, utils/imageValidation.js
database/queries/manualMedia.js → database/pg.js, services/s3.js
database/queries/userCollectionPhotos.js → database/pg.js, services/s3.js, utils/imageValidation.js, database/queries/visionItemCrops.js, services/ownerPhotoThumbnail.js
database/queries/visionScanPhotos.js → database/pg.js, services/s3.js, utils/imageValidation.js
database/queries/visionItemRegions.js → database/pg.js, database/queries/utils.js (replaceExisting snapshot delete-before-insert support)
database/queries/visionItemCrops.js → database/pg.js, services/s3.js, database/queries/visionScanPhotos.js
database/queries/profileMedia.js → database/pg.js, services/s3.js
database/queries/passwordReset.js → database/pg.js
database/queries/visionQuota.js → database/pg.js, services/config/SystemSettingsCache.js (lazy, for getMonthlyQuotaAsync)
database/queries/pushDeviceTokens.js → database/pg.js, database/queries/utils.js
database/queries/notificationPreferences.js → database/pg.js, database/queries/utils.js
database/queries/systemSettings.js → database/pg.js, database/queries/utils.js
database/queries/newsSeen.js → database/pg.js
database/queries/newsDismissed.js → database/pg.js
database/queries/admin.js → database/pg.js, database/queries/utils.js
database/queries/adminContent.js → database/pg.js, database/queries/utils.js
```

### Utility Dependencies

```
utils/errorHandler.js       (no internal imports)
utils/normalize.js           (no internal imports)
utils/adminAuth.js           (no internal imports — uses crypto)
utils/imageValidation.js     (no internal imports — uses file-type, image-size)
utils/withTimeout.js         (no internal imports)
utils/payloadLogger.js       (no internal imports — uses fs)
utils/RateLimiter.js         (no internal imports)
utils/visionBox2d.js        (shared bbox normalization helpers for pipeline/cropper/Gemini)
```

### Adapters

```
adapters/openlibrary.adapter.js  (no internal imports — transforms API responses)
adapters/hardcover.adapter.js    (no internal imports)
adapters/tmdb.adapter.js         (no internal imports)
adapters/tmdbTv.adapter.js       (no internal imports)
adapters/musicbrainz.adapter.js  → services/collectables/fingerprint.js
adapters/discogs.adapter.js      → services/collectables/fingerprint.js
```

### Config Files (data, not code)

```
config/constants.js              (no internal imports — env-backed constants)
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
  → mobile/src/polyfills/index.js
      → mobile/src/polyfills/message-channel.js
  → mobile/src/App.js
```

### App.js (Root)

```
mobile/src/App.js
  -> context/AuthContext.js
  -> context/ThemeContext.js
  -> context/PushContext.js
  -> context/ToastContext.js
  -> navigation/BottomTabNavigator.js
  -> navigation/linkingConfig.js
  -> services/api.js
  -> components/Toast.js
  -> screens/* (all 33 screens listed below)
```

### Context Providers

```
context/AuthContext.js
  (no internal imports - pure createContext)

context/ThemeContext.js
  -> theme/index.js (dark theme)
  -> theme/theme_light.js

context/ToastContext.js
  (no internal imports)

context/PushContext.js
  -> services/pushNotifications.js
  -> context/AuthContext.js
```

### Navigation

```
navigation/BottomTabNavigator.js
  -> context/ThemeContext.js
  -> screens/SocialFeedScreen.js
  -> screens/ShelvesScreen.js
  -> screens/ShelfCreateScreen.js
  -> screens/ShelfSelectScreen.js
  -> screens/ShelfDetailScreen.js
  -> screens/ShelfEditScreen.js
  -> screens/ItemSearchScreen.js
  -> screens/CollectableDetailScreen.js
  -> screens/MarketValueSourcesScreen.js
  -> internal ShelvesStack routes: ShelvesHome, ShelfCreateScreen, ShelfSelect, ShelfDetail, ShelfEdit, ItemSearch, CollectableDetail

navigation/linkingConfig.js
  (no internal imports)
```

### Services

```
services/api.js
  (no internal imports — leaf node)

services/feedApi.js
  → services/api.js

services/newsApi.js
  → services/api.js

services/pushNotifications.js
  → services/api.js

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
  → context/ToastContext.js
  → services/api.js

hooks/useAuthDebug.js
  → services/api.js

hooks/useNews.js
  → context/AuthContext.js
  → services/api.js

hooks/useShelfDetailSync.js  (no internal imports — createContext)
hooks/useFriendSearchSync.js (no internal imports — createContext)
```

### Components

```
components/Toast.js
  → context/ThemeContext.js
  → context/ToastContext.js

components/VisionProcessingModal.js
  → context/ThemeContext.js

components/ShelfVisionModal.js
  (no internal imports)

components/FooterNav.js
  → assets/icons/*.png (legacy, likely unused)
```

### UI Components (barrel: components/ui/index.js)

```
ui/AccountSlideMenu.js
  → context/AuthContext.js
  → context/ThemeContext.js
  → ui/Avatar.js

ui/AppLayout.js
  → ../../../../shared/theme/tokens.js  ← CROSS-COMPONENT

ui/Avatar.js
  → ui/CachedImage.js
  → theme/index.js

ui/Badge.js → theme/index.js
ui/Button.js → theme/index.js
ui/Card.js → theme/index.js
ui/Input.js → theme/index.js
ui/Skeleton.js → theme/index.js

ui/CachedImage.js
  → ../../../../shared/theme/tokens.js  ← CROSS-COMPONENT

ui/CategoryIcon.js → utils/iconConfig.js

ui/EmptyState.js
  → theme/index.js
  → ui/Button.js

ui/Grid.js → ../../../../shared/theme/tokens.js  ← CROSS-COMPONENT
ui/Hero.js → ../../../../shared/theme/tokens.js  ← CROSS-COMPONENT
ui/ShelfListItem.js → ../../../../shared/theme/tokens.js  ← CROSS-COMPONENT

ui/StarRating.js → context/ThemeContext.js
```

### News Components

```
components/news/NewsFeed.js
  → context/ThemeContext.js
  → hooks/useNews.js
  → components/news/NewsSection.js
  → components/news/QuickCheckInModal.js

components/news/NewsSection.js
  → context/ThemeContext.js
  → components/news/NewsCard.js

components/news/NewsCard.js
  → components/ui/CachedImage.js
  → context/ThemeContext.js

components/news/QuickCheckInModal.js
  → context/ThemeContext.js
  → context/ToastContext.js
  → context/AuthContext.js
  → services/api.js
```

### Screens → Internal Dependencies

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
| CollectableDetailScreen | AuthContext, ThemeContext, ui/CachedImage, ui/StarRating, ui/CategoryIcon, api, coverUrl, assets/tmdb-logo.svg, expo-image-manipulator, expo-file-system/legacy |
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
theme/index.js       (no internal imports — dark theme tokens)
theme/theme_light.js (no internal imports — light theme tokens)
```

---

## Website Dependency Tree

### Entry + Route Segments

```
website/src/app/layout.tsx
  → website/src/app/globals.css
  → website/src/content.json

website/src/app/page.tsx
  → website/src/content.json
  → website/src/app/WaitlistForm.tsx
  → website/src/app/page.module.css

website/src/app/WaitlistForm.tsx
  → website/src/app/waitlist-form.module.css
  → (env) NEXT_PUBLIC_API_BASE

website/src/app/reset-password/page.tsx
  → website/src/app/reset-password/reset-password-client.tsx

website/src/app/reset-password/reset-password-client.tsx
  → website/src/app/reset-password/reset-password.module.css
  → next/link
  → (env) NEXT_PUBLIC_API_BASE
  → (env) NEXT_PUBLIC_RESET_DEEP_LINK_BASE
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
  → src/App.jsx
  → src/context/AuthContext.jsx (AuthProvider)
  → src/index.css
```

### App.jsx (Router)

```
src/App.jsx
  → src/context/AuthContext.jsx (useAuth)
  → src/components/Layout.jsx
  → src/pages/Login.jsx
  → src/pages/Dashboard.jsx
  → src/pages/Users.jsx
  → src/pages/Content.jsx
  → src/pages/ActivityFeed.jsx
  → src/pages/SocialFeed.jsx
  → src/pages/Jobs.jsx
  → src/pages/AuditLog.jsx
  → src/pages/Settings.jsx
```

### Context

```
src/context/AuthContext.jsx
  → src/api/client.js (login, logout, getMe)
```

### API Client

```
src/api/client.js
  (no internal imports — leaf node, uses axios)
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
  → src/context/AuthContext.jsx (useAuth)

src/pages/Dashboard.jsx
  → src/api/client.js (getStats, getSystemInfo, getDetailedStats, getRecentFeed)
  → src/components/StatsCard.jsx
  → src/components/UserAvatar.jsx
  → src/utils/errorUtils.js

src/pages/Users.jsx
  → src/api/client.js (getUsers)
  → src/components/UserTable.jsx
  → src/components/UserDetailModal.jsx
  → src/components/Pagination.jsx

src/pages/Content.jsx
  → src/api/client.js (getShelves)
  → src/components/UserAvatar.jsx
  → src/components/Pagination.jsx
  → src/components/ShelfDetailModal.jsx

src/pages/ActivityFeed.jsx
  → src/api/client.js (getRecentFeed)
  → src/components/UserAvatar.jsx
  → src/components/Pagination.jsx

src/pages/SocialFeed.jsx
  → src/api/client.js (getAdminSocialFeed, getAdminEventComments, deleteEvent)
  → src/components/UserAvatar.jsx
  → src/components/Pagination.jsx
  → src/utils/errorUtils.js

src/pages/Jobs.jsx
  → src/api/client.js (getJobs)
  → src/components/Pagination.jsx
  → src/components/JobDetailModal.jsx

src/pages/AuditLog.jsx
  → src/api/client.js (getAuditLogs)
  → src/components/Pagination.jsx

src/pages/Settings.jsx
  → src/context/AuthContext.jsx (useAuth)
  → src/api/client.js (getSettings, updateSetting)
  → src/utils/errorUtils.js
```

### Components

```
src/components/Layout.jsx
  → src/components/Sidebar.jsx

src/components/Sidebar.jsx
  → src/context/AuthContext.jsx (useAuth)

src/components/UserTable.jsx
  → src/components/UserAvatar.jsx
  → src/components/UserBadge.jsx (SuspendedBadge, AdminBadge, PremiumBadge)

src/components/UserDetailModal.jsx
  → src/api/client.js (getUser, suspendUser, unsuspendUser, toggleAdmin, togglePremium, getUserVisionQuota, resetUserVisionQuota, setUserVisionQuota)
  → src/components/UserAvatar.jsx
  → src/components/UserBadge.jsx (default: UserBadge)
  → src/utils/errorUtils.js

src/components/JobDetailModal.jsx
  → src/api/client.js (getJob)
  → src/utils/errorUtils.js

src/components/ShelfDetailModal.jsx
  → src/api/client.js (getShelf, getShelfItems)
  → src/components/UserAvatar.jsx
  → src/components/Pagination.jsx
  → src/utils/errorUtils.js

src/components/StatsCard.jsx     (uses react-router-dom useNavigate)
src/components/UserBadge.jsx     (leaf — no internal imports)
src/components/UserAvatar.jsx    (leaf — no internal imports)
src/components/Pagination.jsx    (leaf — no internal imports)
```

### Utils

```
src/utils/errorUtils.js          (leaf — no internal imports)
```

### Reverse Dependency Map (who imports each file)

| File | Imported By |
|---|---|
| `api/client.js` | AuthContext, Dashboard, Users (via UserDetailModal), Content (via ShelfDetailModal), ActivityFeed, SocialFeed, Jobs (via JobDetailModal), AuditLog, Settings |
| `context/AuthContext.jsx` | main, App, Login, Settings, Sidebar |
| `components/Layout.jsx` | App |
| `components/Sidebar.jsx` | Layout |
| `components/StatsCard.jsx` | Dashboard |
| `components/UserTable.jsx` | Users |
| `components/UserDetailModal.jsx` | Users |
| `components/JobDetailModal.jsx` | Jobs |
| `components/ShelfDetailModal.jsx` | Content |
| `components/UserBadge.jsx` | UserTable, UserDetailModal |
| `components/UserAvatar.jsx` | UserTable, UserDetailModal, Dashboard, ActivityFeed, SocialFeed, Content, ShelfDetailModal |
| `components/Pagination.jsx` | Users, ActivityFeed, SocialFeed, Jobs, AuditLog, Content, ShelfDetailModal |
| `utils/errorUtils.js` | Dashboard, UserDetailModal, JobDetailModal, ShelfDetailModal, Settings, SocialFeed |

---

## Database Schema Map

### Tables and Relationships

```
users (UUID PK)
  ├─< shelves (user_id FK)
  │     ├─< user_collections (shelf_id FK)
  │     │     ├── collectables (collectable_id FK) ──> collectables table
  │     │     └── user_manuals (manual_id FK) ──> user_manuals table
  │     │         (CHECK: exactly one of collectable_id or manual_id)
  │     └─< needs_review (shelf_id FK)
  ├─< user_manuals (user_id FK)
  │     └── cover_media_path (S3/local)
  ├─< user_ratings (user_id FK)
  │     ├── collectable_id FK ──> collectables
  │     └── manual_id FK ──> user_manuals
  ├─< friendships (requester_id / addressee_id FK)
  ├─< event_aggregates (user_id FK)
  │     ├─< event_logs (aggregate_id FK)
  │     ├─< event_likes (aggregate_id FK, user_id FK)
  │     └─< event_comments (aggregate_id FK, user_id FK)
  ├─< notifications (user_id FK, actor_id FK)
  ├─< push_device_tokens (user_id FK)
  ├── notification_preferences (user_id PK)
  ├── user_vision_quota (user_id PK)
  ├─< password_reset_tokens (user_id FK)
  ├─< wishlists (user_id FK)
  │     └─< wishlist_items (wishlist_id FK)
  ├─< user_favorites (user_id FK)
  │     ├── collectable_id FK ──> collectables
  │     └── manual_id FK ──> user_manuals
  ├─< user_lists (user_id FK)
  │     └─< user_list_items (list_id FK)
  ├─< user_news_seen (user_id FK)
  ├─< user_news_dismissed (user_id FK)
  ├── profile_media (user_id FK)
  ├── premium_locked_by_admin (BOOLEAN, default FALSE)
  └─< admin_action_logs (admin_id FK)

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

item_replacement_traces (BIGSERIAL PK)
  -> user_id (FK -> users.id)
  -> shelf_id (FK -> shelves.id)
  -> source_item_id (integer source user_collections.id reference)
  -> source_collectable_id / source_manual_id (exactly one required)
  -> trigger_source in {collectable_detail, shelf_delete_modal}
  -> status in {initiated, completed, failed}
  -> target_item_id (integer target user_collections.id reference, required on completed)
  -> target_collectable_id / target_manual_id (exactly one required on completed)
  -> metadata JSONB, initiated_at, completed_at

user_market_value_estimates (SERIAL PK)
  -> user_id (FK -> users.id)
  -> collectable_id (FK -> collectables.id, nullable)
  -> manual_id (FK -> user_manuals.id, nullable)
  -> estimate_value (TEXT NOT NULL)
  -> created_at, updated_at
  CHECK: exactly one of collectable_id/manual_id set
  UNIQUE(user_id, collectable_id) partial, UNIQUE(user_id, manual_id) partial

system_settings (key VARCHAR PK)
  ├── value (JSONB, not null)
  ├── description (TEXT, nullable)
  └── updated_by (FK → users.id, nullable)

collectables (SERIAL PK)
  ├── fingerprint (SHA1 hash, unique)
  ├── lightweight_fingerprint
  ├── kind ∈ {book, movie, game, album}
  ├─< editions (collectable_id FK)
  ├─< media (collectable_id FK)
  └─< news_items (collectable_id FK, nullable)

news_items (SERIAL PK)
  ├── category, item_type, source
  ├── expires_at (cache TTL)
  ├─< user_news_seen (news_item_id FK)
  └─< user_news_dismissed (news_item_id FK)
```

### Key Constraints

- `user_collections`: CHECK ensures exactly one of `collectable_id` or `manual_id` is set
- `user_collections`: UNIQUE partial index on `(user_id, shelf_id, manual_id)` when `manual_id IS NOT NULL` (prevents duplicate manual links on one shelf)
- `user_manuals`: UNIQUE partial index on `(user_id, shelf_id, manual_fingerprint)` when `manual_fingerprint IS NOT NULL` (prevents duplicate manual rows per shelf fingerprint)
- `friendships`: CHECK prevents self-friendship; status ∈ {pending, accepted, blocked}
- `shelves.type` ∈ {books, movies, games, vinyl, tv, other}
- `shelves.visibility` ∈ {private, friends, public}
- `users.email`: UNIQUE constraint
- `collectables.title`: GIN pg_trgm index for fuzzy search

### Row Level Security (RLS)

- **Tier 1** (user isolation): shelves, user_collections, user_manuals, user_ratings, needs_review, item_replacement_traces, push_device_tokens, notification_preferences, user_vision_quota, wishlists, wishlist_items, user_favorites, user_lists, user_list_items
- **Tier 2** (visibility): shelves (public/friends), profiles
- **Tier 3** (complex joins): friendships, feed
- **Tier 4** (cascading): dependent tables
- Admin bypass via `is_current_user_admin()` DB function
- Context set via `SET LOCAL "app.current_user_id"` in `queryWithContext()` / `transactionWithContext()`

### Migration History (54 files, 2026-01-10 -> 2026-03-25)

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
| `20260121_normalize_shelf_types_plural` | Data migration (shelf types → plural) |
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
| `20260323_create_vision_scan_photo_regions` | + `vision_scan_photos`, + `vision_item_regions` (scan storage + bbox region linking) |
| `20260323_add_vision_scan_tables_rls` | RLS policies for `vision_scan_photos` and `vision_item_regions` |
| `20260323_create_vision_item_crops` | + `vision_item_crops` (private generated region crop artifacts keyed by `region_id`) |
| `20260323_add_vision_item_crops_rls` | RLS policies for `vision_item_crops` |
| `20260323_add_owner_photo_secondary_media` | + `users.show_personal_photos` and `user_collections.owner_photo_*` secondary media columns + constraints/indexes |
| `20260323_add_owner_photo_thumbnail_variant` | + `user_collections.owner_photo_thumb_*` metadata columns and normalized `owner_photo_thumb_box_check` constraint |
| `20260324_add_collection_item_id_to_vision_item_regions` | + `vision_item_regions.collection_item_id` FK -> `user_collections.id` + index `idx_vision_item_regions_collection_item` for exact region-to-item crop attachment |
| `20260325010000_create_item_replacement_traces` | + `item_replacement_traces` table (source/target item refs, trigger source/status lifecycle, metadata, analytics indexes) |
| `20260325010010_add_item_replacement_traces_rls` | RLS policies for `item_replacement_traces` (`*_isolation` + `*_admin`) |

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
├── theme/
│   └── tokens.js    (ES module: colors, spacing, radii, typography, shadow)
└── styles/
    └── app.css
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

