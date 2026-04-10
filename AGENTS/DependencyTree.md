# ShelvesAI Dependency Tree

> **Maintenance rule:** Any agent making changes to the codebase MUST update this file to reflect new files, removed files, changed imports, new tables, or new routes. This is a living document.
> **Recent changes mandate:** Any agent making changes to the codebase MUST append a dated entry to the **Recent Changes Log** section in this file before finishing work.

Last updated: 2026-04-09

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
â”œâ”€â”€ api/              Express 5 REST API (Node.js, CommonJS, port 5001)
â”œâ”€â”€ mobile/           Expo SDK 54 / React Native 0.81 / React 19
â”œâ”€â”€ website/          Next.js 16 App Router marketing + account flows
â”œâ”€â”€ admin-dashboard/  Vite 7 + React 18 SPA (port 5173)
â”œâ”€â”€ packages/         Local extractable CommonJS packages consumed by app surfaces
â”œâ”€â”€ shared/           Design tokens (ES module, consumed by mobile via Metro)
â””â”€â”€ docker-compose.yml  PostgreSQL 16 + pgAdmin (local dev)
```

**Communication patterns:**
- `mobile -> api`: REST over HTTPS, Bearer JWT auth, token in expo-secure-store
- `website -> api`: REST over HTTPS for password reset validate/update
- `admin-dashboard -> api`: REST via `/api/admin/*`, HttpOnly cookie auth + CSRF header
- `shared -> mobile`: Metro watchFolders (not a package, direct file import)
- `shared -> admin-dashboard`: NOT consumed (admin uses Tailwind)
- `shared -> api`: NOT consumed

---

## Recent Changes Log

> **Mandate for all agents:** For every codebase change, append one entry here using `YYYY-MM-DD | area | summary`.
> Include only concrete, merged-in-file impacts (routes/contracts/imports/tables/workflow behavior), not exploratory notes.

- 2026-04-09 | collectable-user-details-section | Added collectable-only per-shelf-item `Your details` support across API and mobile. Database now persists `user_collections.series/edition/special_markings/age_statement/label_color/regional_item/barcode/item_specific_text` via migration `20260409130000_add_user_collection_item_details` and init schema parity. Shelf item hydration in `api/database/queries/shelves.js` now joins `user_market_value_estimates` and `api/controllers/shelvesController.js` emits a `userDetails` object on collectable shelf items, plus new owner endpoint `PUT /api/shelves/:shelfId/items/:itemId/details` saves those fields and the existing user market estimate. Mobile adds new `mobile/src/screens/ItemDetailsScreen.js`, registers it in both root and Shelves-tab stacks, and updates `CollectableDetailScreen` to render owner-editable `Your details` between `Details` and `Tags` while keeping manual edit flow unchanged.

- 2026-04-09 | collectable-detail-feed-context-hydration | Fixed missing owner perspectives (crop photos, customized notes, favorited status) when navigating to owned items from generic contexts like social feed check-ins. Added new API endpoints `GET /api/collectables/:collectableId/shelf-item` and `GET /api/manuals/:manualId/shelf-item` to dynamically fetch the user's shelf context. Updated `mobile/src/screens/CollectableDetailScreen.js` to initialize `activeShelfId` and `activeItemId` via state, seamlessly fetching and hydrating the missing shelf context whenever `ownerId` matches the current user and intrinsic shelf data is absent.

- 2026-04-09 | collectable-detail-hide-cover-media-url | Updated `mobile/src/screens/CollectableDetailScreen.js` metadata filtering so internal cover URL fields (`coverMediaUrl` and `cover_media_url`) are omitted from the user-visible Details section for all item types.

- 2026-04-09 | mobile-activity-added-item-detail-links | Expanded added-event activity previews so `FeedDetailScreen`, `SocialFeedScreen`, and `ProfileScreen` now treat added-item thumbnails and titles as direct detail links for both collectables and manuals, while falling back to public owner-photo thumbnails whenever no official cover exists. `mobile/src/utils/feedAddedEvent.js` now carries `manualId` plus shared `hasAddedItemDetailTarget()` / `buildAddedItemDetailParams()` helpers, and new pure-JS regression coverage in `mobile/src/utils/feedAddedEvent.test.js` locks collectable/manual detail-route selection.

- 2026-04-09 | crop-as-fallback-cover | Extended owner crop photo to serve as fallback cover when no API-sourced cover exists, for all shelf types. `api/controllers/shelvesController.js` `formatShelfItem()` now includes `hasPhoto: true` in the `ownerPhoto` response object for consistency with `formatOwnerPhotoResponse()`. `mobile/src/screens/ShelfDetailScreen.js` `resolveCoverSource()` refactored to extract owner photo resolution into a reusable `resolveOwnerPhotoCover()` helper; any item without a standard cover (`resolveCollectableCoverUrl` / `resolveManualCoverUrl` both null) now falls back to the owner's crop thumbnail or full image. `mobile/src/screens/SocialFeedScreen.js` broadened `getOtherOwnerThumbSource` → `getOwnerThumbSource` removing the `isOtherShelfAdded` gate so single-item and multi-item added-event cards try crop thumbnails as fallback covers for all shelf types. Privacy gating unchanged: owner photo endpoints enforce `owner_photo_visible` + `show_personal_photos` server-side; mobile falls back to icon placeholder via `onError` on 403.
- 2026-04-09 | vision-crop-warmup-unlimited | Added `VISION_CROP_WARMUP_UNLIMITED` env knob (boolean, default `false`) that bypasses the `VISION_CROP_WARMUP_MAX_REGIONS` cap so all detected regions receive crops. Queue-pressure throttle (`VISION_CROP_WARMUP_PRESSURE_MAX_REGIONS`) and queue-depth bail-out (`VISION_CROP_WARMUP_DEFER_QUEUE_DEPTH`) still apply when unlimited is active. `api/controllers/shelvesController.js` parses and passes `warmupUnlimited` to the crop service, `@shelvesai/vision-crops` `lib/service.js` resolves the setting and sets `warmupLimit` to `Infinity` when enabled. Added regression coverage in `api/__tests__/visionCropService.test.js`.
- 2026-04-09 | token-based-vision-quota-rollout | Completed the token-based vision quota rollout across API, mobile, and admin dashboard. Backend now persists `user_vision_quota.tokens_used` / `output_tokens_used` correctly on admin overrides, exposes `users.unlimited_vision_tokens` through auth/admin payloads, and wires admin route `POST /api/admin/users/:userId/toggle-unlimited-vision`. Mobile `AccountScreen` now shows percentage-based quota remaining when token quota data is present. Admin dashboard `UserDetailModal` and API client now support unlimited-vision toggling plus token-based quota display/editing. Added focused regression coverage in `api/__tests__/{visionQuota,adminQueries.userDetail,adminController.visionQuota}.test.js` and updated `api/__tests__/shelvesController.test.js` quota mocks.
- 2026-04-09 | vision-large-multi-region-extracting-progress | Added a scout-aware large multi-region extracting progress state so scans with `fullImageEstimatedItemCount > 20` and more than 2 detected regions now emit `extracting-large-multi-region` with an interpolated estimated-item message during the extraction loop. `api/services/visionPipeline.js` now resolves the extracting progress state once from scout output and reuses it through multi-region slice/region extraction, `api/config/visionProgressMessages.json` includes the new templated message, and `api/__tests__/visionPipeline.test.js` covers both the qualifying and non-qualifying threshold cases.
- 2026-04-09 | news-recommendation-4k-profile-scalar-fix | Fixed `api/services/discovery/newsRecommendations.js` so the profile CTE sums all matching 4K-format counts instead of using a scalar subquery that can return multiple rows, which unblocks feed-time news recommendation generation when a user library contains multiple 4K label variants. Added focused regression coverage in `api/__tests__/newsRecommendations.test.js`.
- 2026-04-09 | vision-crop-warmup-priority-fix | Fixed warm crop prioritization for scan regions so the installed `@shelvesai/vision-crops` service now spends capped warmup budget on regions already linked to shelf items before unlinked review/duplicate regions, preventing saved shelf items from missing attached vision crops when scans exceed the warmup limit. Added focused regression coverage in `api/__tests__/visionCropService.test.js`.
- 2026-04-09 | collectable-s3-cover-url-resolution | Fixed collectable/feed cover hydration for S3-backed media so `api/routes/collectables.js` now emits `coverMediaUrl` alongside `coverMediaPath`, `api/controllers/feedController.js` now synthesizes resolved media URLs for payload-built items and preserves full collectable cover fields in aggregate detail hydration, and `mobile/src/utils/coverUrl.js` now prefers resolved CDN/external URLs over raw media keys when `coverMediaUrl` is absent. Added regression coverage in `api/__tests__/{collectablesRoute.helpers,feedController.mergeCheckinRatingPairs}.test.js` and new pure-JS mobile test `mobile/src/utils/coverUrl.test.js`.
- 2026-04-08 | vision-scout-pipeline-and-crops-v1 | Installed `@shelvesai/vision-crops@1.0.0` from tarball (replacing dev symlink). Redesigned vision detection pipeline with scout-crop-queue architecture: new `api/services/visionScout.js` sends a lightweight prefilter prompt to gather image layout metadata (regions, item counts) before detection; new `api/services/visionSlicer.js` computes vertical slice rects, extracts slice buffers via Sharp, remaps slice-local coordinates to full-image, and deduplicates cross-slice detections by IoU. `VisionPipelineService.processImage()` now runs scout → crop → per-slice prompt queue → reassemble for non-other shelves when `VISION_SCOUT_ENABLED=true`, falling back to existing single-call `extractItems()` path for `other` shelves and when scout is disabled. Added `GoogleGeminiService.sendScoutPrompt()` for lightweight Gemini prefilter calls. New progress stages `scouting` (5%) and `slicing` (12%) in `visionProgressMessages.json`. Env knobs: `VISION_SCOUT_ENABLED`, `VISION_SLICE_ENABLED`, `VISION_SLICE_THRESHOLD`, `VISION_SLICE_COUNT`, `VISION_SLICE_OVERLAP_RATIO`, `VISION_DEDUPE_IOU_THRESHOLD`. Removed `packages/vision-crops/` dev source directory. `@shelvesai/vision-core@1.0.0` tarball delivered in `packages/` but not installed.
- 2026-04-07 | vision-crop-package-extraction | Extracted the vision crop domain into top-level local package `packages/vision-crops` published in-repo as `@shelvesai/vision-crops`. The package now owns bbox normalization, Sharp crop extraction, region list/crop retrieval orchestration, crop warmup queue-pressure handling, and review-time crop relinking. `api/controllers/shelvesController.js` now consumes an injected crop service instead of embedding crop orchestration, `api/services/{visionCropper}.js` and `api/utils/{visionBox2d}.js` are thin compatibility re-exports, `api/database/queries/visionItemCrops.js` now trusts generated crop metadata instead of re-running generic image validation, and new regression coverage in `api/__tests__/visionCropService.test.js` plus updated controller/crop tests lock the package boundary.
- 2026-04-02 | mobile-android-footer-clearance-unification | Reworked footer-visible mobile Android bottom spacing around a shared runtime footer contract. `mobile/src/navigation/BottomTabNavigator.js` now uses the live safe-area bottom inset again, new helper `mobile/src/navigation/useBottomFooterLayout.js` exposes `isInsideBottomTab`, `tabBarHeight`, `bottomSafeInset`, and derived content/floating bottom offset calculators, and footer-visible screens (`SocialFeedScreen`, `ShelvesScreen`, `ShelfCreateScreen`, `ShelfSelectScreen`, `ShelfEditScreen`, `ItemSearchScreen`, `MarketValueSourcesScreen`, `ShelfDetailScreen`, `CollectableDetailScreen`) now replace hardcoded bottom padding / ad hoc footer math with helper-driven bottom clearance.
- 2026-04-07 | collectables-platform-data-insert-default | Hardened `api/database/queries/collectables.js` so `collectables.upsert()` always binds `platform_data` as `[]` on inserts when callers omit platform metadata, while still preserving the existing boolean-gated no-overwrite behavior for updates. Added regression coverage in `api/__tests__/collectablesUpsertMediaSync.test.js` for omitted-platform insert payloads, which fixes review completion inserts from `needs_review` into `collectables` when `raw_data` lacks `platformData`.
- 2026-04-07 | review-completion-hydration-and-metadata-retention | Hardened `needs_review` completion so `api/controllers/shelvesController.js` now relinks scan artifacts before rehydrating the finished shelf item, and both `POST /api/shelves/:shelfId/review/:id/complete` and `PUT /api/unmatched/:id` return the full hydrated shelf-item contract (including `ownerPhoto` when present) instead of thin completion summaries. Expanded `api/database/queries/shelves.js#getItemById()` to match shelf-item hydration fields used by `formatShelfItem()`, widened `api/services/manuals/otherManual.js#buildOtherManualPayload()` to retain supported review metadata (`publisher`, `format`, tag/genre-derived tags, and existing market/edition/barcode fields), and added regression coverage in `api/__tests__/{shelvesController,unmatchedRoutes}.test.js` for crop-backed owner-photo restoration and unmatched-route hydrated responses.
- 2026-04-02 | onboarding-config-retry-and-profile-avatar-normalization | Hardened mobile onboarding config bootstrap so `mobile/src/App.js` now tracks `onboardingConfigLoading`/`onboardingConfigError`, exposes `refreshOnboardingConfig()` through `mobile/src/context/AuthContext.js`, and auto-retries a missing config once when users enter onboarding. Added shared onboarding config gate UI (`mobile/src/components/onboarding/OnboardingConfigGate.js` + `mobile/src/utils/onboardingConfig.js`) and wrapped all onboarding screens so config fetch failures now show retryable errors instead of indefinite `Loading onboarding...` stalls. Consolidated profile-photo picking/upload into shared mobile service `mobile/src/services/profilePhotoUpload.js` backed by pure helper `profilePhotoUpload.shared.js`, removed native picker editing in favor of app-managed square prep, and standardized avatar rendering through `mobile/src/utils/mediaUrl.js` so relative `profileMediaUrl` values resolve correctly against `apiBase`. Backend profile photo writes now run through new normalization helper `api/services/profileImageUpload.js` before `api/database/queries/profileMedia.js` persists bytes. Added focused coverage in `mobile/src/{utils/onboardingConfig.test.js,services/profilePhotoUpload.shared.test.js}` and `api/services/profileImageUpload.test.js`.
- 2026-04-02 | local-db-migration-baseline-repair | Added local-only DB repair scripts `api/scripts/stamp-local-knex-migrations.js` and `api/scripts/patch-local-user-favorites-manual-id.js` plus npm commands `db:local:stamp-migrations` and `db:local:patch-favorites-manual-id`. These scripts safely target localhost-only development databases, stamp `knex_migrations` for schema-snapshot local DBs, and patch `user_favorites.manual_id` plus related constraints/indexes when the local snapshot lags the runtime/manual-favorites contract.
- 2026-04-02 | mobile-image-upload-format-normalization | Added shared mobile upload prep helper `mobile/src/services/imageUpload.js::prepareImageUploadAsset()` so device-picked shelf photos, manual covers, and owner photos are normalized to upload-safe JPEG assets before hitting the API. `mobile/src/screens/{ShelfCreateScreen,ShelfEditScreen,CollectableDetailScreen}.js` now run picker results through that helper, preserve generated filename/type fields in multipart form data, and therefore support default iOS HEIC/HEIF and modern Android photo formats without requiring camera-setting changes.
- 2026-04-02 | shelf-related-upload-resizing-and-error-normalization | Added shared backend image prep in `api/services/shelfImageUpload.js` so shelf photos, owner photos, and manual covers now auto-orient and downscale server-side only when uploads exceed the existing `4096x4096` bound, while preserving allowed JPEG/PNG/WEBP formats. `api/database/queries/{shelfPhotos,userCollectionPhotos,manualMedia}.js` now store processed bytes/metadata from that helper, owner-photo thumbnail regeneration now uses the processed upload buffer, `api/controllers/shelvesController.js` no longer pre-validates manual covers in-controller, and `api/routes/shelves.js` now raises multipart image uploads to 10MB and normalizes tagged multer/image-filter failures through new `api/middleware/imageUploadErrorHandler.js` to return JSON `400/413` instead of generic `500`s. Added coverage in `api/services/shelfImageUpload.test.js`, `api/middleware/imageUploadErrorHandler.test.js`, and new query tests `api/database/queries/{manualMedia,userCollectionPhotos}.test.js` plus updated `api/database/queries/shelfPhotos.test.js`.
- 2026-04-02 | dense-other-box-refinement-progress | Added dense-scan bbox refinement for Gemini-backed `other` shelves so crowded scans (`>10` detected items by default) now run a geometry-only Gemini follow-up before `vision_item_regions` persistence. `api/services/googleGemini.js` adds batched `refineDenseItemBoxes()` chat/vision refinement without `googleSearch`, `api/services/visionPipeline.js` applies refined boxes best-effort before `persistVisionRegions()` while preserving second-pass metadata-only box stability, and `api/config/visionProgressMessages.json` adds a new `refining-dense-boxes` progress stage with shifted downstream percentages so the mobile vision modal explains the extra crowded-shelf step. Added regression coverage in `api/__tests__/{googleGemini,visionPipeline,visionCropper}.test.js`.
- 2026-04-02 | vision-review-retention-and-other-gating | Relaxed `'other'` shelf review gating so high-confidence title-only items can auto-save as manuals without creator metadata, while keeping barcode-safe duplicate detection and skipping creator-dependent fingerprint/fuzzy matching when creator is absent. `api/services/visionPipeline.js` now persists `rawData.reviewContext` (`scanPhotoId`, `extractionIndex`, `shelfType`, `reason`) on all `needs_review` writes, `api/database/queries/visionItemRegions.js` adds `getByExtractionIndexForScan()`, and `api/controllers/shelvesController.js` now centralizes review completion via shared helper exported to `api/routes/unmatched.js`, relinking vision regions/crops back onto completed review items so crop-backed owner photos and other persisted scan metadata survive review completion. Added regression coverage in `api/__tests__/{otherManual,visionPipeline,shelvesController,unmatchedRoutes}.test.js`.
- 2026-04-02 | mobile-android-expo-go-tab-safe-area-clamp | Revised bottom-tab Android handling for Expo Go/runtime parity. `mobile/src/navigation/BottomTabNavigator.js` now clamps React Navigation bottom tab safe-area inset to `0` on Android while preserving iOS bottom inset handling, and derives the custom tab/action-stack height from that same platform-specific inset so Android tabs render at a fixed visual height without the oversized dead band above system controls.
- 2026-04-01 | mobile-android-bottom-tab-inset-fix | Fixed Android bottom-tab footer spacing for edge-to-edge devices by removing custom tab-bar bottom padding override from `mobile/src/navigation/BottomTabNavigator.js` so React Navigation owns the safe-area inset, and replaced fixed `88` px persistent-footer assumptions in `mobile/src/screens/ShelfDetailScreen.js` and `mobile/src/screens/CollectableDetailScreen.js` with shared helper `mobile/src/navigation/useOptionalBottomTabBarHeight.js` that reads the live bottom tab bar height from navigation context.
- 2026-04-02 | mobile-android-onboarding-and-icon-alignment | Hardened mobile onboarding routing so post-login auth now refreshes `/api/account` before deciding whether onboarding is required, using shared helper `mobile/src/utils/onboarding.js` in both `mobile/src/App.js` bootstrap and `mobile/src/screens/LoginScreen.js` to prevent incomplete auth payloads from skipping the intro/profile flow. Aligned Expo icon config in `mobile/app.json` to canonical `mobile/assets/icon.png`, synced `mobile/assets/{icon,logo-android,adaptive-icon}.png` to the current iOS app icon, and updated `mobile/generate-icons.js` to keep those Android-facing assets sourced from the current iOS icon instead of regenerating the legacy camera artwork.
- 2026-04-02 | mobile-icon-source-correction | Corrected the mobile icon source after identifying the purple shelf mark was itself stale. `mobile/assets/icon.png` and `mobile/ios/ShelvesAI/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png` now use `website/public/logo-v2.png`, while Android adaptive assets `mobile/assets/{logo-android,adaptive-icon}.png` now use `website/public/logo-android.png`. `mobile/app.json` again points Android adaptive foreground at `mobile/assets/logo-android.png`, and `mobile/generate-icons.js` now syncs from the website logo assets instead of the retired purple iOS icon.
- 2026-04-02 | mobile-shelf-spine-color-extraction-fix | Fixed `ShelfDetailScreen` spine-mode color extraction so `renderSpineItem()` now passes the visible cover image source into `SpineItem`, and spine color extraction now normalizes string and `{ uri, headers }` image sources before calling `react-native-image-colors`. The spine UI continues to fall back to the existing title-hash palette only when no usable image color can be extracted or when extraction is intentionally disabled in Expo Go.
- 2026-04-01 | auth-username-or-email-login | Updated consumer auth login to keep the existing `{ username, password }` request contract while allowing `/api/login` and `/api/auth/login` to authenticate by case-insensitive username or email. `api/database/queries/auth.js` now resolves login identifiers across both fields, rejects ambiguous cross-user username/email collisions with a generic invalid-credentials response, and logs ambiguity for follow-up while preserving bcrypt timing padding. `api/controllers/authController.js` now trims the incoming login identifier before validation. Added rollout audit script `api/scripts/audit-login-identifier-collisions.js` plus `npm run audit:login-identifiers`, added regression coverage in `api/__tests__/authQueries.login.test.js`, `api/__tests__/authController.login.test.js`, and `api/__tests__/authLoginRoutes.test.js`, and made `api/__tests__/setup.js` tolerate missing local `dotenv` installs in minimal test environments.
- 2026-04-01 | mobile-ios-textinput-autofill-stability-policy | Added shared mobile text-input policy helper `mobile/src/utils/textInputPolicy.js` with explicit iOS non-auth suppression (`autoCorrect=false`, `spellCheck=false`, `autoComplete='off'`, `textContentType='none'`) and auth semantics (`username`, `email`, `password`, `newPassword`) retained for credential fields. Wired helper into high-traffic non-auth input surfaces (`GlobalSearchBar`, `FriendSearchScreen`, `ProfileScreen`, `ProfileEditScreen`, `OnboardingProfileRequiredScreen`, `OnboardingProfileOptionalScreen`, `AccountScreen` feedback modal, `QuickCheckInModal`) plus auth flows (`LoginScreen`, `ForgotPasswordScreen`, `ResetPasswordScreen`). Replaced `AccountScreen` feedback modal `autoFocus` with deferred `InteractionManager.runAfterInteractions` focus and cancellation cleanup to reduce UIKit keyboard queue contention during modal transitions. Added pure-JS regression test `mobile/src/utils/textInputPolicy.test.js`.
- 2026-04-01 | vision-extraction-heartbeat-progress | Added extraction heartbeat progress stages between 10% and 50% for long-running vision OCR scans. `api/config/visionProgressMessages.json` now includes `extractingInFlight` (`extracting-in-flight`, 20%) and `extractingDeepParse` (`extracting-deep-parse`, 30%). `api/services/visionPipeline.processImage()` now schedules timed heartbeat updates at 3s/9s while extraction is in-flight and clears timers in `finally` to prevent stale updates. Progress updates are now monotonic (never regress percent when later stages report lower configured values). Added test coverage in `api/__tests__/visionPipeline.test.js` for long-running extraction heartbeat emission and fast-extraction heartbeat suppression.
- 2026-04-01 | vision-catalog-circuit-breaker-and-hash-retry-cleanup | Added per-scan-job catalog provider circuit breaker for router-based lookup (`api/services/catalog/CatalogRouter.js`) with hard-error tripping (abort/timeout, 5xx, 429, network/transport), provider skip diagnostics, and `CATALOG_PROVIDERS_UNAVAILABLE` failure (`api/services/catalog/errors.js`, `api/services/catalog/providerErrorUtils.js`). Book catalog first-pass now forwards shared `catalogContext` and propagates provider-outage failures (`api/services/catalog/BookCatalogService.js`). Vision pipeline now passes catalog context into high/medium catalog passes, rethrows global provider outages, logs catalog diagnostics, and reduces duplicate save writes by reusing first `_ocrGroupKey` catalog result within a scan (`api/services/visionPipeline.js`). Vision job execution now purges hash artifacts on provider-outage failure via new query helpers (`vision_result_cache.deleteByHash`, `vision_scan_photos.deleteByHash`) and sync scan endpoint returns HTTP 503 with `{ code: "CATALOG_PROVIDERS_UNAVAILABLE" }` (`api/controllers/shelvesController.js`, `api/database/queries/visionResultCache.js`, `api/database/queries/visionScanPhotos.js`). Added/updated tests in `api/services/catalog/CatalogRouter.test.js`, `api/services/catalog/BookCatalogService.test.js`, `api/__tests__/visionPipeline.test.js`, and `api/__tests__/shelvesController.test.js`.
- 2026-04-01 | shelf-detail-screen-display-modes | Implemented four distinct display modes (`tile`, `banner`, `list`, `swipe`) for the Shelf Detail mobile screen to enhance browsing individual shelf items. Added `AsyncStorage` persistence for user view mode preference, created new Display Mode Modal, injected Banner mode section headers grouping items by Format (Physical/Digital/Unknown) with an optional secondary sub-grouping by Year when sorted by Year. Implemented a horizontal full-screen Swipe view with darkened item cover backgrounds and metadata overlay. Updated `mobile/src/screens/ShelfDetailScreen.js` layout state management, dynamic `layoutData` configs, and layout rendering styles.
- 2026-04-01 | shelves-screen-display-modes | Implemented four distinct display modes (`tile`, `banner`, `list`, `swipe`) for the Shelves mobile screen to enhance collection browsing. Added `AsyncStorage` persistence for user mode preference, created new Display Mode Modal, grouped shelves with section headers for `banner` mode, added metadata including item count and date for `list` mode, and implemented a premium horizontal-scrolling card view with darkened background image overlays for `swipe` mode. Updated `mobile/src/screens/ShelvesScreen.js` rendering logic, state management, and `createStyles` to fully support these layouts while maintaining search capability.
- 2026-04-01 | shelf-delete-post-success-navigation-reset | Updated `mobile/src/screens/ShelfEditScreen.js` shelf deletion flow to keep the confirmation alert, await successful `DELETE /api/shelves/:shelfId`, and then perform a root-level navigation reset (`Main -> Shelves -> ShelvesHome`) via `CommonActions.reset` so users reliably land on their Shelves list after deletion instead of remaining on stale nested `ShelfEdit` state.
- 2026-04-01 | shelf-level-custom-photos | Added shelf-level custom photo support across API + mobile. Database now persists shelf photo storage metadata via migration `20260401110000_add_shelf_photo_fields` (`shelves.photo_storage_provider/key/content_type/size_bytes/width/height/updated_at` + `shelves_photo_storage_check`), with init schema parity. Added new query module `api/database/queries/shelfPhotos.js` (upload/load/clear with private S3-or-local storage and old-asset cleanup). Added shelf photo routes `GET /api/shelves/:shelfId/photo`, `GET /api/shelves/:shelfId/photo/image`, `POST /api/shelves/:shelfId/photo`, `DELETE /api/shelves/:shelfId/photo` in `api/routes/shelves.js` and controller handlers in `api/controllers/shelvesController.js`. Shelf payloads from create/get/list/update now expose normalized `shelfPhoto` contract (`hasPhoto/contentType/sizeBytes/width/height/updatedAt/imageUrl`) while omitting raw storage columns. Mobile `ShelfDetailScreen` now supports owner upload/replace/remove from a shelf-photo hero card and refreshes shelf list cache after changes; `ShelvesScreen` now renders shelf photos (tile/list/swipe) with authenticated image requests + fallback icons. Added coverage in `api/__tests__/shelvesController.test.js` and new query tests `api/database/queries/shelfPhotos.test.js`.
- 2026-04-01 | shelf-photo-card-moved-to-edit-screen | Relocated shelf-photo management UI from `mobile/src/screens/ShelfDetailScreen.js` to `mobile/src/screens/ShelfEditScreen.js`. `ShelfEditScreen` now renders the shelf photo hero card with authenticated preview and owner actions (`Upload`/`Replace`/`Remove`) using the existing `/api/shelves/:shelfId/photo` endpoints; `ShelfDetailScreen` now only displays shelf content without shelf-photo editing controls.
- 2026-04-01 | shelf-create-photo-upload-section | Added an optional shelf-photo upload section to `mobile/src/screens/ShelfCreateScreen.js`. Users can pick/replace/remove a local photo during creation; after successful `POST /api/shelves`, the screen uploads that photo to `POST /api/shelves/:shelfId/photo` and then navigates to the new shelf detail.
- 2026-04-01 | shelves-list-pagination-sorting-and-etag-caching | Extended `GET /api/shelves` in `api/controllers/shelvesController.js` to support paged sorting (`limit`, `skip`, `sortBy`, `sortDir`) with safe sort whitelist mapping (`type`, `name`, `createdAt`, `updatedAt`), deterministic tie-break ordering (`s.id`), response sort metadata, and conditional requests via ETag + `If-None-Match` (`304` + `Cache-Control: private, max-age=0, must-revalidate`). Added controller coverage in `api/__tests__/shelvesController.test.js` for default/invalid sort fallback, all supported sort combinations, pagination metadata, and 304 behavior. Mobile now has shared shelves list cache/service (`mobile/src/services/shelvesListCache.js`, `mobile/src/services/shelvesListService.js`) with 60s in-memory cache keyed by page+sort and ETag-aware fetches, `apiRequest` 304/meta support plus centralized shelves-cache invalidation on successful non-GET `/api/shelves*` writes (`mobile/src/services/api.js`), `ShelvesScreen` browse-mode pagination + sort modal + search-mode sort disable (`mobile/src/screens/ShelvesScreen.js`), and paged full-shelf loading in `mobile/src/screens/ShelfSelectScreen.js` and `mobile/src/components/AddToShelfModal.js`.
- 2026-03-31 | owned-platform-format-required-and-row-badge | Tightened game-owned-platform editing contract. `mobile/src/screens/CollectableDetailScreen.js` now blocks save until ownership format is selected (`Physical`/`Digital`), shows a required prompt when unset, and renders ownership format badges in each Owned Platforms row after save. Backend `api/controllers/shelvesController.updateOwnedPlatforms` now requires `format` for game collectables and returns 400 when missing/empty/invalid. Extended coverage in `api/__tests__/shelvesController.test.js` with missing-format rejection and required-format success assertions.
- 2026-03-31 | metadata-score-persistence-and-igdb-rating-separation | Fixed metadata score persistence so DB `collectables.metascore` now stores only metadata-quality scoring payloads (`score/maxScore/missing/scoredAt`) and no longer accepts IGDB rating objects. `api/services/catalog/GameCatalogService.mapIgdbGameToCollectable()` no longer maps IGDB ratings into `metascore`; ratings remain under `extras.igdb.ratings`. `api/services/visionPipeline.saveToShelf()` now computes metadata scores via `MetadataScorer` for new scan saves, merges with carried `_metadata*` values, and persists the highest score. `api/routes/collectables.buildCollectableUpsertPayloadFromCandidate()` and `api/controllers/shelvesController.buildCollectableUpsertPayload()` now prioritize scorer-derived `_metadata*` fields and reject non-metadata-shaped `metascore` payloads. `CatalogRouter`/`CollectableMatchingService` now propagate `_metadataMaxScore` and `_metadataScoredAt` alongside `_metadataScore`/`_metadataMissing`. Added/updated tests in `api/services/catalog/GameCatalogService.test.js`, `api/__tests__/collectablesRoute.helpers.test.js`, and `api/__tests__/visionPipeline.test.js`.
- 2026-03-31 | platform-missing-insert-default-fix | Fixed `user_collections.platform_missing` NOT NULL insert failures for non-game add flows (including vision bulk saves) by updating `api/database/queries/shelves.addCollectable` to persist `FALSE` when platform missing is omitted and to only mutate `platform_missing` on conflict updates when explicitly provided. Added query regression coverage in `api/database/queries/shelves.test.js`.
- 2026-03-31 | games-shelf-defaults-mismatch-guard-and-platform-missing | Implemented games-shelf default platform/format inheritance with mismatch guarding across add/review/replace/vision/catalog save paths. Added `api/services/gameShelfDefaults.js` shared resolver, `shelves.game_defaults` JSONB and `user_collections.platform_missing` BOOLEAN via migration `20260331190000_add_shelf_game_defaults_and_platform_missing`, and wired shelf create/update/list/get payload contracts to round-trip normalized `gameDefaults` plus item-level `platformMissing`. `PUT /api/shelves/:shelfId` now propagates changed games defaults to existing shelf items with overwrite semantics (owned platforms + format + missing state). Mobile `ShelfCreateScreen`/`ShelfEditScreen` now expose optional games defaults UI (with overwrite warning on edit), and `ShelfDetailScreen` + `CollectableDetailScreen` render a `Platform missing` badge/chip when flagged.
- 2026-03-31 | collectable-detail-game-format-and-rating-visibility | Updated game detail UX and owned-platform save contract. `mobile/src/screens/CollectableDetailScreen.js` now relabels game `maxPlayers` as `# of Players`, hides `IGDB Rating` when numeric value is `0.0`, and adds Owned Platforms edit-time format selection (`Physical`/`Digital`) included in `PUT /api/shelves/:shelfId/items/:itemId/platforms` payload. Backend `api/controllers/shelvesController.updateOwnedPlatforms` now validates optional `format` (`physical|digital`) and persists it via new helper `api/database/queries/collectables.updateFormat`; response now includes updated `item.collectable.format` when format is provided. Added migration `api/database/migrations/20260331143000_restore_collectables_format_column.js` to ensure `collectables.format` exists before writes. Added/updated controller tests in `api/__tests__/shelvesController.test.js`.
- 2026-03-31 | igdb-platform-backfill-max-players-and-env-local-override | Updated `api/scripts/backfill-collectable-platform-data.js` to also backfill `collectables.max_players` alongside `platform_data`/`igdb_payload` using IGDB multiplayer mapping (`mapped.maxPlayers` fallback extraction). The scriptâ€™s `ONLY_MISSING` mode now includes rows where `max_players IS NULL`, and env loading is explicit `.env` first with `.env.local` override when present for local testing.
- 2026-03-31 | collectables-max-players-persistence | Added dedicated game-player-cap persistence on collectables. New migration `20260331130000_add_collectables_max_players` adds `collectables.max_players` (INTEGER, nullable) and init schema now includes the same column. `database/queries/collectables.upsert` now binds/writes `max_players`, and `routes/collectables.buildCollectableUpsertPayloadFromCandidate()` now forwards `maxPlayers` from API candidates into upsert payloads so game imports persist explicit player caps for downstream detail/search rendering.
- 2026-03-31 | games-igdb-payload-and-maxplayers-contract | Expanded game metadata capture/contract coverage. Added `collectables.igdb_payload` JSONB persistence (migration `20260331120000_add_collectables_igdb_payload`, init schema update) and extended `GameCatalogService` IGDB query/mapping to capture full payload (`fields *`) plus ratings/multiplayer structures in one call. `mapIgdbGameToCollectable()` now emits top-level `maxPlayers` (from multiplayer modes), while collectable response shaping derives/exposes `maxPlayers` for game payloads from explicit/source/IGDB multiplayer metadata without exposing raw `igdbPayload` in public responses. Included helper regression coverage in `api/services/catalog/GameCatalogService.test.js` and `api/__tests__/collectablesRoute.helpers.test.js`.
- 2026-03-31 | collectables-search-offset-type-fix | Fixed Postgres parameter typing bug in global collectables search where `OFFSET` could bind as text (`code 42804`). Updated query parameter ordering/binding in collectables search SQL paths so pagination uses numeric offsets reliably.
- 2026-03-31 | catalog-timeout-queue-ordering-fix | Hardened outbound catalog timeout behavior to avoid false `"The user aborted a request."` under queue pressure. In `api/services/openLibrary.js`, `fetchJson()` now creates/starts `AbortController` timeout inside the `limitOpenLibrary(...)` executed task so queue wait does not consume timeout budget. In `api/services/hardcover.js`, `HardcoverClient.fetchGraphQL()` now starts timeout inside the `limitHardcover(...)` executed task and after local `RateLimiter.acquire()` wait, so both local limiter waits are excluded from timeout accounting.
- 2026-03-31 | games-platform-ownership-and-igdb-platform-capture | Implemented game platform ownership + IGDB platform capture. Added `collectables.platform_data` JSONB persistence (migration `20260331100000_add_collectables_platform_data`, init schema update) and new `user_collection_platforms` table with uniqueness/indexing for case-insensitive per-item platform ownership (migration `20260331101000_create_user_collection_platforms`, init schema update). `GameCatalogService.mapIgdbGameToCollectable()` now maps full IGDB platform/release-date platform metadata into `platformData`; `collectables.upsert` now supports provided-only `platform_data` overwrite semantics. Added strict local game `platform=` filtering in `GET /api/collectables` and `GET /api/checkin/search` using `collectables.system_name` + `collectables.platform_data` while keeping existing API fallback/supplement behavior. Shelf hydration/search now includes `ownedPlatforms`, add flows auto-seed default owned platform from game `systemName` (`addCollectable`, `addCollectableFromApi`, review completion, vision save), and new owner endpoint `PUT /api/shelves/:shelfId/items/:itemId/platforms` updates platform chips per shelf item. Mobile updates: `CollectableDetailScreen` now hides game `systemName` in Details, replaces legacy owned-platform UI with a collapsible `Owned Platforms` section (per-platform rows + added date), and supports owned-platform editing; `ShelfDetailScreen` renders owned platform chips on list cards (single-row item model retained). Added script `api/scripts/backfill-collectable-platform-data.js` + npm command `backfill:collectable-platform-data`.
- 2026-03-30 | onboarding-terms-logout-escape | Added `Back to Login` control on mobile onboarding Terms acceptance step (`mobile/src/screens/OnboardingProfileOptionalScreen.js`). Action clears secure token/session state (`clearToken`, auth context `setToken('')`, clears user/onboarding flags) so users can exit onboarding and return directly to the login flow.
- 2026-03-30 | push-notification-duplicate-dedup | Fixed duplicate push deliveries from stale token rows + duplicate notification inserts. `pushDeviceTokens.registerToken` is now transactional with per-installation stale-token deactivation and opportunistic legacy-token cleanup; mobile push registration now sends stable persisted `deviceId` values (`install:<uuid>`) and always refreshes current Expo token on login/start before backend registration. Added migration `20260330200000_add_notification_dedup_indexes` to soft-delete older active duplicates and add partial unique indexes for workflow terminal notifications + `friend_accept`; `database/queries/notifications.create` now uses conflict-safe insert branches for those types. Mirrored new notification indexes in `database/init/01-schema.sql` and added regression tests in `api/__tests__/pushDeviceTokens.test.js` and `api/__tests__/notificationsQueries.test.js`.
- 2026-03-30 | checkin-socialfeed-post-refresh-signal | Added targeted post-check-in feed refresh wiring for Social Feed without creating a new feed route. `BottomTabNavigator` now passes `originTab` when opening `CheckIn` modal (`mobile/src/navigation/BottomTabNavigator.js`), new event helper `mobile/src/services/checkInEvents.js` broadcasts successful check-ins, `CheckInScreen` emits that event then closes via `navigation.goBack()`, and `SocialFeedScreen` subscribes to the event to trigger immediate top-scroll + refresh when returning/focused.
- 2026-03-30 | checkin-search-global-fallback-unification | Unified check-in item discovery with global collectables search fallback. `GET /api/checkin/search` now reuses global-search helper logic from `routes/collectables` for API fallback flags/limits/container resolution/provider lookup caching while still returning manual-item hits from local SQL (`api/routes/checkin.js`). Endpoint now returns source/search metadata (`searched`, `resolvedContainer`, `sources`) and supports fallback/supplement query flags. `mobile/src/screens/CheckInScreen.js` now requests fallback-enabled check-in search, adds inline type-chip filtering, adds `See more results` API-supplement reruns with expanded limits, and resolves API-backed candidates through `POST /api/collectables/resolve-search-hit` before creating check-ins. Added regression coverage in `api/__tests__/checkinSearchQuery.test.js`.
- 2026-03-30 | onboarding-terms-link-revert | Reverted onboarding terms URL target back to `https://shelvesai.com/terms` by restoring API default `TERMS_OF_SERVICE_URL` (`api/config/constants.js`) and undoing the temporary `/terms/termsContent.json` linkage. Website terms page import reverted to local `src/app/terms/termsContent.json` and temporary `public/terms/termsContent.json` endpoint copy was removed.
- 2026-03-30 | tv-global-search-api-container-fix | Fixed TV fallback API search resolution by wiring shared `TvCatalogService` into `CollectableMatchingService` catalog service selection (`api/services/collectableMatchingService.js`), so `GET /api/collectables` typed fallback searches with `resolvedContainer=tv` now call TMDB TV lookup paths instead of returning `No catalog service for type: tv`. Added regression coverage in `api/__tests__/collectableMatchingService.test.js`.
- 2026-03-30 | onboarding-terms-json-linking | Redirected onboarding Terms link target to the JSON content endpoint by changing API default `TERMS_OF_SERVICE_URL` to `https://shelvesai.com/terms/termsContent.json` (`api/config/constants.js`). Website terms page now reads from `website/public/terms/termsContent.json` (moved source out of `src/app/terms/termsContent.json`) so both `/terms` rendering and onboarding link reference the same JSON payload path.
- 2026-03-30 | onboarding-terms-acceptance | Added onboarding Terms of Service acceptance enforcement across API + mobile. API now appends active terms metadata to `/api/config/onboarding` (`terms.version`, `terms.url`), requires `termsAccepted=true` + matching `termsVersion` on `POST /api/onboarding/complete`, and persists `users.terms_accepted`, `users.terms_accepted_version`, and `users.terms_accepted_at` via new migration `20260330180000_add_users_terms_acceptance_fields`. Mobile onboarding optional step now renders a required Terms section with link-out to `/terms`, checkbox consent, and includes acceptance payload in onboarding completion request. Added backend coverage in `api/__tests__/onboardingController.test.js`.
- 2026-03-30 | website-terms-of-service | Added /terms page to website covering user conduct, illegal/lewd content, harassment, doxxing, and advertising.
- 2026-03-30 | account-feedback-submission | Implemented in-app Account Settings feedback submission flow. Mobile `AccountScreen` now includes a `Send Feedback` settings row opening a multiline prompt modal that submits to `POST /api/account/feedback`. API `routes/account.js` now exposes authenticated feedback endpoint with string-length validation; `controllers/accountController.submitFeedback` validates message + hydrates user contact details and calls new `services/emailService.sendFeedbackEmail(...)`. `emailService` now supports support-inbox feedback delivery via Resend (`SUPPORT_EMAIL` default `support@shelvesai.com`). Added coverage in `api/__tests__/accountController.feedback.test.js`.
- 2026-03-30 | admin-workfeed-live-queue-monitoring | Added admin-facing live workflow queue monitoring in existing Jobs area. API adds read-only admin endpoints `GET /api/admin/workfeed` and `GET /api/admin/workfeed/:jobId` (wired in `routes/admin.js`, implemented in `controllers/adminController.js`) backed by new query helpers in `database/queries/workflowQueueJobs.js` for filtered/paginated queue listing, active-default ordering (`processing` then `queued` by queue order), and derived `queuePosition`/`queuedMs`. Responses are enriched with single-instance in-memory progress (`step/progress/message`) via `services/processingStatus`. Admin dashboard adds `getWorkfeed`/`getWorkfeedJob` client APIs, introduces Workfeed-first tabbed Jobs UI with 5s polling + race-safe refresh in `pages/Jobs.jsx`, and adds read-only queue detail modal `components/WorkfeedDetailModal.jsx`. Added backend coverage in `__tests__/adminWorkfeedController.test.js` and `database/queries/workflowQueueJobs.admin.test.js`.
- 2026-03-30 | vision-workflow-queue-and-outbound-throttling | Implemented durable Postgres-backed workflow queueing for vision requests with claim-safe worker execution (`FOR UPDATE SKIP LOCKED`) via new `workflow_queue_jobs` table/query module/service (`database/queries/workflowQueueJobs.js`, `services/workflowQueueService.js`, `services/workflow/workflowSettings.js`). `POST /api/shelves/:shelfId/vision` now enqueues uncached async jobs and returns queue metadata (`status`, `queuePosition`, `estimatedWaitSeconds`, `notifyOnComplete`), `GET /api/shelves/:shelfId/vision/:jobId/status` now returns queue metadata + DB fallback hydration, and `DELETE /api/shelves/:shelfId/vision/:jobId` now supports queued and running abort semantics. Added route-level ingress rate limiting on `/vision` and `/catalog-lookup`, per-user queued cap protection, queue-depth-aware crop warmup capping, in-flight dedupe (`user+shelf+image_sha256`) and hash short-circuit for duplicate scan uploads. Added shared outbound limiter registry for Gemini/provider/S3 calls (`services/outboundLimiterRegistry.js`) and shared catalog service singletons (`services/catalog/sharedCatalogServices.js`) to prevent per-request limiter resets. Added queue-only workflow notifications (`workflow_complete`/`workflow_failed`, `entity_type=workflow_job`) plus `notification_preferences.push_workflow_jobs` support in API and mobile notification settings/tap routing.
- 2026-03-29 | shelves-search-cast-members | Expanded the `searchUserCollection` SQL payload in `api/database/queries/shelves.js` to select the `cast_members` JSONB column from `collectables` (casting to `NULL::jsonb` for manuals and shelves). Extended the fuzzy string search logic with `c.cast_members::text ILIKE '%' || $1 || '%'` to enable finding collection items by their cast members natively. Updated UI in `mobile/src/screens/ShelvesScreen.js` to destructure `.name` from the parsed `castMembers` layout and push them into the dynamically matched tags pill rendering system alongside genres and tags.
- 2026-03-29 | add-to-shelf-from-detail | Added "Add to shelf" feature for CollectableDetailScreen when item has no shelf context (search, favorites, deep link, social feed). API: removed `requireFields(['collectableId'])` from `POST /api/shelves/:shelfId/items` in `api/routes/shelves.js`; extended `shelvesController.addCollectable` to accept `manualId` as alternative to `collectableId` (validates ownership, uses existing `shelvesQueries.getManualById` and `shelvesQueries.addManualCollection`). Mobile: new `mobile/src/components/AddToShelfModal.js` shelf picker modal (fetches user shelves, client-side name filter, per-row adding spinner, Alert feedback) importing `ThemeContext` and `api.js`. Integrated into `mobile/src/screens/CollectableDetailScreen.js` with conditional "Add to shelf" button (shown when `!hasShelfItemContext && user?.id`), success checkmark state, and modal render.
- 2026-03-29 | tmdb-full-cast-jsonb-and-indexed-search | Added end-to-end TMDB full cast persistence for movies/TV into `collectables.cast_members` JSONB. Updated TMDB movie/TV adapters to map full `credits.cast` with normalized entries (`personId`, `name`, `nameNormalized`, `character`, `order`, `profilePath`), extended `collectables.upsert` to persist/merge `cast_members` with provided-only overwrite semantics, and wired cast forwarding through `routes/collectables` resolve-upsert flow, `controllers/shelvesController` payload building, `services/visionPipeline` collectable payload saves, and `services/discovery/CollectableDiscoveryHook` upserts. Added exact cast-name search support via `cast_members @> '[{\"nameNormalized\":...}]'` in `database/queries/collectables.searchGlobal` plus `GET /api/collectables` default count query path. Added DB migration `20260329010000_add_collectables_cast_members` and mirrored schema/index in `database/init/01-schema.sql` with partial GIN index `idx_collectables_cast_members_gin` (`jsonb_path_ops`). Added backfill script `api/scripts/backfill-collectable-cast-members.js` + npm command `backfill:collectable-cast`. Expanded regression coverage in movie/tv catalog service tests, collectables upsert tests, fuzzy/search SQL tests, route helper payload tests, and added new backfill helper tests.
- 2026-03-29 | shelves-search-extended-metadata | Expanded the shelves search payload in `api/database/queries/shelves.js` to include `year`, `genre`, and `tags` via UNION ALL. Injected explicit `ILIKE` clauses targeting `array_to_string` conversions for genres and tags to allow deep querying of categorical item data. Updated `mobile/src/screens/ShelvesScreen.js` to destructure tags and genres, cleanly matching the user's active search query to dynamically highlight searched tags in the UI below the item text, while injecting year badges alongside format indicators.
- 2026-03-29 | item-search-manual-trigger-and-add-anyways-guidance | Updated `mobile/src/screens/ItemSearchScreen.js` shelf add/replace UX to remove automatic debounced searching and restore explicit user-triggered catalog search via `Search Catalog` button. Added post-search instructional copy under the search action explaining result tap-to-add and manual fallback usage. Added always-available shelf-mode fallback CTA at the bottom of searched results (`Add anyways...` / replacement variant) after a valid search run, preserving existing add/replace submission flows and advanced-from-friend mode behavior.
- 2026-03-29 | item-search-unified-manual-fallback-and-50-cap | Refactored `mobile/src/screens/ItemSearchScreen.js` shelf add/replace flow into a single unified search surface: removed separate manual fallback section and manual suggestion modal (`POST /api/shelves/:shelfId/manual/search` path no longer used by this screen), added 500ms debounced shelf-mode catalog search with minimum 3-character threshold, enforced DB->API lookup before exposing manual fallback CTA, and reused primary search inputs for manual add/replace payloads when no matches are found. Shelf-mode search now requests 50-result pages/fallback while advanced-from-friend mode behavior remains unchanged. Updated `api/routes/collectables.js` fallback cap (`MAX_FALLBACK_LIMIT`) from 25 to 50 and adjusted `api/__tests__/collectablesRoute.helpers.test.js` expectations for new fallback-limit and computed fetch-limit behavior.
- 2026-03-29 | shelves-search-expanded-collection | Expanded local "Search shelves..." bar in `ShelvesScreen` to search across both the user's shelves and their entire collection of items. Added `GET /api/shelves/search` endpoint backed by `searchUserCollection` (UNION ALL across `shelves`, `collectables`, `user_manuals`). Updated `ShelvesScreen.js` to use an async debounced search, caching state, and pagination. Replaced synchronous shelf filtering with a sectioned list view demonstrating shelf rows and mixed item cards detailing badges (movie, book, format) and shelf origin names. Enforced List view whenever a search is active.
- 2026-03-29 | global-search-api-fallback-type-selector | Added typed global-search fallback + tap-to-upsert flow. API `GET /api/collectables` now supports `fallbackApi` and `fallbackLimit`, returns source annotations (`fromApi`/`source`) plus `searched`/`resolvedContainer` metadata, and runs `CollectableMatchingService.searchCatalogAPIMultiple(...)` only when local results are zero (container resolution priority: explicit type, query alias via shelf type resolver, dominant user shelf type, default books). Added authenticated `POST /api/collectables/resolve-search-hit` to resolve and upsert tapped API results into canonical collectables. Mobile `GlobalSearchBar` now includes a type selector (`All`, `Books`, `Movies`, `Games`, `TV`, `Vinyl`), sends selected type with fallback flags, displays source chips on item rows, and resolves/upserts API hits before navigating to detail. Added helper tests in `api/__tests__/collectablesRoute.helpers.test.js`.
- 2026-03-29 | friend-search-typed-filter-input-and-advanced-empty-cta | Enhanced `mobile/src/screens/FriendSearchScreen.js` result filters to support typed exact values in each filter modal (`Creator`, `Year`, `Genre`, `Platform`) via new inline text input + `Apply exact` action, so users can apply filters even when dynamic option lists do not contain their value. Updated items-tab empty states to include an `Open Advanced Search` CTA when no collectable results are found (including filter-no-match state), routing users directly to `ItemSearch` advanced mode from FriendSearch.
- 2026-03-29 | friend-search-client-result-filters | Enhanced `mobile/src/screens/FriendSearchScreen.js` with client-side result filters derived from existing DB+API payload fields. Added normalized extraction and dynamic option generation for Creator, Year, Genre, and Platform (`primaryCreator/author/director/developer/creators[0]`, `year/releaseYear/publishYear`, `genre/genres`, `systemName/platform/platforms[0]`), plus under-search filter chips and modal selectors (`Any` + single-select value per category) with `Clear filters`. Item list rendering now applies AND-based filtering to loaded `itemResults` only, preserves existing search/dedupe/ranking/pagination flow, conditionally shows Platform filter for games/available-platform payloads, and includes a dedicated empty state when active filters produce zero visible rows.
- 2026-03-29 | friend-search-layout-type-chip-inline-and-advanced-under-search | Updated `mobile/src/screens/FriendSearchScreen.js` layout so the collectable type filter chip is back inside the main search bar at the far right, and moved the `Advanced` action from header-right to a secondary button directly under the primary `Search` button in the right-side search action column. The platform input row now renders independently beneath the search row only when needed (`games` type or platform text present).
- 2026-03-29 | search-bars-done-button-restored | Restored visible keyboard-dismiss `Done` controls in `mobile/src/components/ui/GlobalSearchBar.js` and `mobile/src/screens/FriendSearchScreen.js`. Both search bars now expose an explicit tap target that blurs the active `TextInput` and calls `Keyboard.dismiss()` to close the mobile keyboard on demand.
- 2026-03-29 | search-bars-done-button-conditional-visibility | Updated `mobile/src/components/ui/GlobalSearchBar.js` and `mobile/src/screens/FriendSearchScreen.js` so the keyboard-dismiss `Done` control is only rendered when the corresponding search input contains text (`query.length > 0`), keeping idle/empty search bars visually clean.
- 2026-03-29 | friend-search-typed-search-more-link | Updated `mobile/src/screens/FriendSearchScreen.js` to show a small tappable `Search more` link at the bottom of collectable results when users arrived with initial type `All`, switched to a specific type, and the last typed search only used local DB results (no API searched/results). Tapping the link reruns the typed search with `forceApiFallback=true` and `forceApiSupplement=true` to fetch provider results for that type without requiring Advanced mode.
- 2026-03-29 | friend-item-search-unified-collectables-engine | Rebuilt `mobile/src/screens/FriendSearchScreen.js` and refactored `mobile/src/screens/ItemSearchScreen.js` to share the same collectables search engine (`mobile/src/hooks/useCollectableSearchEngine.js`) for query building, fallback request flags, paging cursor usage, and client dedupe/ranking/sort behavior. `FriendSearch` now includes a header `Advanced` action, route-param return handling (`advancedReturnToken` + query/type/platform/options), and reruns collectables search in-place on return while preserving Friends tab behavior and All-type disclaimer footer. `ItemSearch` now supports dual mode (`advanced_from_friend` and shelf add/replace), uses shared collectables results + paging in both modes, auto-returns latest advanced params on back to `FriendSearch`, and requires confirmation before shelf add/replace writes from search selections. Backend `GET /api/collectables` now accepts optional `platform`, threads it into fallback lookup input/cache-key only for `games` (IGDB-capable path), and keeps non-games fallback behavior unchanged; helper coverage in `api/__tests__/collectablesRoute.helpers.test.js` now includes platform-aware lookup assertions.
- 2026-03-29 | friend-search-all-type-disclaimer-footer | Updated `mobile/src/screens/FriendSearchScreen.js` items list footer to show a contextual disclaimer when searching with type `All`: `Search by type to see more results.` The footer appears at the end of non-empty search results and coexists with the existing paging spinner so users are nudged toward typed searches that hit provider-specific APIs more effectively.
- 2026-03-29 | friend-search-strict-creator-token-matching-and-local-weak-demotion | Tightened FriendSearch creator-match classification to token-exact logic (removed permissive substring containment that misclassified near names like `Noland` as `Nolan`) and updated incoming-page composition to place weak local matches (tier 3) after ranked API matches, so irrelevant local rows no longer occupy prime positions ahead of high-confidence creator matches. Extended debug payloads with local preferred/weak buckets and per-bucket ranking metadata.
- 2026-03-29 | friend-search-kind-canonicalization-and-api-quality-tiebreak | Fixed FriendSearch client dedupe gap by canonicalizing collectable kinds before keying (`movies`/`movie`, `books`/`book`, etc.) so local/API duplicates now collapse correctly when title+creator match across singular/plural kind variants. Also added API same-tier quality tie-break sorting to demote likely meta/noise titles (query-heavy and `untitled` titles) behind stronger creator-match film titles while preserving stable order as final fallback.
- 2026-03-29 | friend-search-micro-debug-logging | Added dev-only targeted diagnostics in `mobile/src/screens/FriendSearchScreen.js` for troubleshooting API/local merge behavior on problematic queries (default target includes `christopher nolan`). New logs capture initial/paged collectables response metadata, API ranking tiers, normalized dedupe keys, and explicit drop reasons (`duplicate_exact_key`, `duplicate_identity_key`, `duplicate_kind_title_creator_equivalent`) during incremental append processing.
- 2026-03-29 | friend-search-creator-token-match-dedupe-hardening | Refined `mobile/src/screens/FriendSearchScreen.js` incoming-page ranking and dedupe for creator-driven queries: API match tiers now treat creator matches as normalized/token-aware (exact phrase, containment, and all-query-token coverage) so relevant director/author results are prioritized above noisy API rows, and duplicate suppression now includes a kind+title fallback with creator-equivalence checks (handles reordered/expanded creator strings like `Nolan, Christopher` vs `Christopher Nolan`) in addition to strict kind+title+creator and id/external-id identity checks.
- 2026-03-29 | friend-search-incremental-dedupe-exact-boost | Updated `mobile/src/screens/FriendSearchScreen.js` item search paging flow to process each incoming page before append: kind+title+creator normalization/deduping (client-side local/API/API duplicate suppression), stable API-tier reordering by exact query match quality (both exact -> title exact -> creator exact -> non-exact) while preserving local-result precedence, and pagination cursor hardening via `itemPagination.nextOffset` derived from server pagination metadata instead of rendered list length so client-side dedupe does not cause offset drift.
- 2026-03-29 | provider-level-fallback-api-paging | Implemented true provider-level paging for collectables fallback. `GET /api/collectables` now threads pagination offset into fallback cache keys and provider calls, and infers `hasMore` using limit+1 fetch behavior. `CollectableMatchingService.searchCatalogAPIMultiple(...)` now forwards `{ limit, offset }` to catalog services. Added/updated provider offset support in movie (TMDB page traversal), tv (TMDB page traversal), games (IGDB `offset`), music (MusicBrainz `offset`), and books (new `BookCatalogService.safeLookupMany` using paged OpenLibrary search). Added `api/services/catalog/BookCatalogService.test.js` and updated catalog/collectables helper tests for the paging contract.
- 2026-03-29 | collectable-type-filter-sql-precedence-fix | Fixed `collectables` search query kind filtering precedence in `api/database/queries/collectables.js` by grouping OR predicates before appending `AND c.kind = ...` in `searchByTitle`, `searchGlobal`, `searchGlobalWildcard`, and `fuzzyMatch`, preventing cross-type leakage (e.g., Books appearing in TV-filtered results). Added/updated regression assertions in `api/__tests__/fuzzyMatching.test.js` to verify grouped WHERE conditions with kind filters.
- 2026-03-29 | global-search-result-chip-type-label | Updated `mobile/src/components/ui/GlobalSearchBar.js` result row badges to display only collectable type labels (Book/Movie/Game/TV/Vinyl/etc.) for both local and API-backed hits; removed `Local` and `API:*` wording from live search result chips.
- 2026-03-29 | global-search-api-usage-throttle-cache | Reduced search-driven API usage for global search. Mobile `GlobalSearchBar` now uses an 800ms debounce, in-memory query+type cache (2 min TTL), and only requests catalog fallback (`fallbackApi=true`) when query length is >= 3 characters. API `GET /api/collectables` now enforces the same minimum query length for external fallback, adds in-memory fallback result caching (TTL + bounded size), and deduplicates in-flight identical fallback requests to avoid repeated provider calls while typing.
- 2026-03-29 | friend-search-see-more-api-rerun-and-filter-ui | Updated global-search "See more results" navigation payload in `mobile/src/components/ui/GlobalSearchBar.js` to pass query/type/API-fallback context (`initialQuery`, `initialType`, `initialUseApiFallback`, `initialFallbackLimit`, `initialTab`). Updated `mobile/src/screens/FriendSearchScreen.js` to auto-focus and rerun incoming queries, request collectables with fallback parameters (`fallbackApi`/`fallbackLimit`) using the API-allowed expanded result count, apply selected type to that request, resolve tapped API hits through `POST /api/collectables/resolve-search-hit`, and adopt the same filter-enabled search bar style (type chip + modal selector) used in global search.
- 2026-03-29 | friend-search-see-more-local-hit-api-supplement | Enhanced typed "See more results" behavior so local-hit searches can still fetch additional API matches. `GlobalSearchBar` now passes `initialApiSupplement` when a specific type is selected and local collectable hits exist. `FriendSearchScreen` forwards `apiSupplement=true` alongside fallback params on collectables search. API `GET /api/collectables` now supports `apiSupplement=true` to merge deduped API results with local DB results (instead of only falling back on local-zero), while preserving existing fallback behavior for non-supplement searches.
- 2026-03-29 | friend-search-keyboard-dismiss-ux | Improved iOS keyboard ergonomics in `mobile/src/screens/FriendSearchScreen.js`: removed automatic search-field focus on initial load (no auto keyboard pop), added explicit in-UI keyboard dismiss control (`Done`/chevron button) that invokes `Keyboard.dismiss()` and input blur, and enabled list-driven keyboard dismissal via `keyboardDismissMode="on-drag"`, `keyboardShouldPersistTaps="handled"`, and `onScrollBeginDrag` dismissal for both items and friends result lists.
- 2026-03-29 | typed-api-search-title-creator-hybrid | Improved typed API fallback query semantics in `api/routes/collectables.js`: fallback now parses structured text patterns (`title by creator`, `title directed by creator`) and forwards both title + creator fields to matching services, runs creator-only fallback lookups for creator-capable containers (`books`, `vinyl`), and dedupes merged API candidates before applying fallback limit. Extended helper exports/tests in `api/__tests__/collectablesRoute.helpers.test.js` for structured parsing and lookup input generation. Updated `api/services/catalog/MusicCatalogService.js` to allow artist-only lookups (when title is empty but artist exists) and adjusted ranking/query builder accordingly; added regression coverage in `api/services/catalog/MusicCatalogService.test.js`.
- 2026-03-29 | movie-game-creator-only-api-fallback | Extended creator-only fallback behavior to `movies` and `games`. In `api/routes/collectables.js`, creator-only lookup inputs now include `movies` and `games` containers for typed fallback/supplement flows. `api/services/catalog/MovieCatalogService.js` now supports director-only lookups by querying TMDB people and directed movie credits (`/search/person`, `/person/{id}/movie_credits`) and reuses `safeLookupMany` for single-result lookup consistency. `api/services/catalog/GameCatalogService.js` now supports developer-only lookups and adds `safeLookupMany` with developer-aware IGDB query filters (`involved_companies.developer` + company name/slug). Added regression coverage in `api/services/catalog/MovieCatalogService.test.js` and `api/services/catalog/GameCatalogService.test.js`.
- 2026-03-29 | fallback-limit-25-and-api-paging | Increased collectables API fallback cap from 5 to 25 in `api/routes/collectables.js` and added paged API fallback behavior for zero-local-result searches (API fallback now honors `offset`/`limit` by fetching a bounded result pool and slicing response pages with accurate `pagination.hasMore`). `GlobalSearchBar` now passes a 25-result fallback limit into "See more results" navigation. `FriendSearchScreen` item results now support incremental paging (`onEndReached`) and request subsequent pages from `/api/collectables` with preserved fallback/supplement options, appending deduped results client-side.
- 2026-03-28 | mention-tagging-in-comments | Added @mention tagging system for comments. New DB migration `20260328000000_add_mention_notification_type.js` expands `notifications` type CHECK constraint to include `'mention'` and adds `push_mentions` boolean to `notification_preferences`. Updated init schema `01-schema.sql` for consistency. API: added `parseMentions()` helper and mention notification logic in `eventSocialController.addComment()` â€” parses `@username` tokens, batch-resolves via new `usersQueries.findByUsernames()`, verifies friendship + event visibility before creating `type='mention'` notifications. Updated `pushNotificationService.buildPushContent()` with `mention` title/body (also fixed existing `comment` body to read `metadata.preview` instead of `metadata.commentText`). Updated `pushController.js` and `notificationPreferences.js` to support `pushMentions` preference field. Mobile: new `useMentionInput` hook (`mobile/src/hooks/useMentionInput.js`) for `@` detection, friend list caching (`GET /api/friends?limit=200` mapped via `isRequester` to flat friend objects), local filtering, and `@username` insertion. New `MentionSuggestions` component (`mobile/src/components/ui/MentionSuggestions.js`) renders absolutely-positioned overlay with avatar/username/name rows. Integrated into `FeedDetailScreen.js` and `SocialFeedScreen.js` comment inputs. Fixed `PushContext.js` deep link param bug: changed `{ eventId: entityId }` to `{ id: entityId }` to match `FeedDetailScreen` route params (fixes broken push notification navigation for like/comment/mention types). Added `mention` case to `NotificationScreen.buildNotificationText()` and `Mentions` toggle to `NotificationSettingsScreen.js`.
- 2026-03-28 | deep-link-share-web-fallback | Implemented cross-service share/deep-link foundation for canonical `https://shelvesai.com/app/...` URLs with web fallback chain. Added new public API route module `api/routes/share.js` mounted at `GET /api/share/*` (`collectables/:id`, `manuals/:id`, `shelves/:id`, `events/:id`) returning `{ visibility, entityType, id, slug, title, description, imageUrl, canonicalUrl, appUrl }` with public-vs-restricted metadata behavior. Added website dynamic share routes under `website/src/app/app/{collectables,manuals,shelves,events}/[id]/[slug]/page.tsx`, shared metadata fetcher `website/src/lib/shareMetadata.ts`, reusable landing/redirect components (`ShareLanding`, `ShareFallbackRedirect`) and new `website/src/app/download/page.tsx`. Added `.well-known` route handlers for iOS/Android association (`apple-app-site-association`, `assetlinks.json`) and env placeholders in `website/.env.example` for store links/fingerprints. Updated mobile deep-link parsing (`mobile/src/navigation/linkingConfig.js`) to canonical `/app/*` paths with legacy alias normalization and manual deep-link handling, updated deep-link test cases/scripts, added manual-id support in `CollectableDetailScreen`, and added iOS/Android app-link config in `mobile/app.json` plus Android manifest HTTPS intent filters.
- 2026-03-28 | native-share-ui-profile-share-links | Added native mobile share actions across event cards (`SocialFeedScreen` + `FeedDetailScreen`), shelf detail header, collectable detail actions, and profile screen actions using new helper service `mobile/src/services/shareLinks.js` (metadata fetch + canonical fallback + `Share.share`). Expanded share backend with `GET /api/share/profiles/:username` in `api/routes/share.js`. Added website profile share route `website/src/app/app/profiles/[username]/[slug]/page.tsx` and extended `website/src/lib/shareMetadata.ts` kind support to `profiles`. Updated mobile deep-link canonical profile support to `app/profiles/:username/:slug?` with legacy `profile/:username` alias compatibility and added deep-link test case coverage.
- 2026-03-27 | mobile-global-search-bar | Extracted global search (friends/collectables API search with floating dropdown) from `SocialFeedScreen` into new shared component `mobile/src/components/ui/GlobalSearchBar.js`, exporting `useGlobalSearch` hook, `GlobalSearchInput`, and `GlobalSearchOverlay`. Both `SocialFeedScreen` and `ShelvesScreen` now use the shared component. Header layout refactored on both screens: search bar + notifications in top row, page title ("Feed" / "My Shelves") in a sub-header row below. `ShelvesScreen` retains its local "Search shelves..." filter below the sub-header. Overlay renders at screen body level (not inside header or Modal) via a `body` wrapper View to correctly shade the body without stealing TextInput focus. Removed inline search state/handlers/styles from `SocialFeedScreen`. Added `GlobalSearchBar` to `ui/index.js` barrel exports.
- 2026-03-27 | mobile-ui-enhancements | Three UI enhancements: (1) `CollectableDetailScreen` owner photo section now shows `<ownerUsername>'s Photo` instead of "Your photos" and hides "added automatically from your scan" when viewing a friend's shelf item (uses existing `isOwnerContext`/`normalizedOwnerUsername` pattern). (2) `ShelfDetailScreen` FAB restyled from primary-colored circle with `+` icon to green (`colors.success`) pill-shaped button with "Add" text, repositioned closer to tab bar (`spacing.sm` offset). (3) Experimental feature-flagged (`ENABLE_PROFILE_IN_TAB_BAR` in new `mobile/src/config/featureFlags.js`, default `false`) profile-in-tab-bar: adds Profile tab at leftmost position in `BottomTabNavigator` with `initialRouteName="Home"` to preserve default landing page, custom flex layout (Profile/Home/Add flex 1, Shelves flex 2 with left-aligned icon) to keep FAB centered and Home centered between Profile and FAB; opens `AccountSlideMenu` sliding left-to-right (new `direction` prop on `AccountSlideMenu`); hides profile icon from `SocialFeedScreen` and `ShelvesScreen` headers when enabled. `AccountSlideMenu` also gained bottom-pinned "My Profile" and "Notifications" links (`BOTTOM_MENU_ITEMS` array, rendered in a `bottomSection` with `marginTop: 'auto'` separator).
- 2026-03-27 | mobile-profile-feed-preview-key-fix | Updated `mobile/src/screens/ProfileScreen.js` added-event preview keys for stacked thumbnails (`other-thumb` + `cover`) to include feed entry identity and index (`entryKey` + item identity + `idx`) so repeated item names no longer collide and trigger React duplicate-key warnings on Profile.
- 2026-03-27 | mobile-social-feed-other-thumb-key-fix | Updated `mobile/src/screens/SocialFeedScreen.js` added-event `other` shelf thumbnail keys to include feed entry identity and index (`entryKey` + item identity + `idx`) so repeated item names no longer generate duplicate React keys (fixes `Encountered two children with the same key ... Dog-other-thumb` warning during feed render).
- 2026-03-27 | mobile-owner-photo-placeholder-book-icon | Updated `SocialFeedScreen`, `FeedDetailScreen`, and `ProfileScreen` `other` added-event fallback thumbnails to use `Ionicons book-outline` instead of `image-outline` when owner-photo thumbnails are redacted/unavailable.
- 2026-03-27 | mobile-cover-resolution-xbox-fix | Fixed missing cover art on detail/search for some vision-imported games by hardening `mobile/src/utils/coverUrl.js` to treat any non-absolute `coverImageUrl` as local media (ignoring stale source metadata), and updating search result renderers in `mobile/src/components/ui/GlobalSearchBar.js` and `mobile/src/screens/FriendSearchScreen.js` to resolve covers via `resolveCollectableCoverUrl(...)` (includes `coverImageUrl` fallback).
- 2026-03-27 | collectable-detail-cover-fallback-hardening | Updated `CollectableDetailScreen.resolveCoverUri()` to retain shelf-provided cover fields (`baseCollectable`) as fallback when refreshed `/api/collectables/:id` payload is missing/partial, preventing regression from a working shelf thumbnail to blank detail hero.
- 2026-03-27 | mobile-feed-owner-thumb-itemid-hardening | Updated `mobile/src/utils/feedAddedEvent.js` owner-photo thumbnail id resolution to use only explicit collection item ids (`item.itemId` / `payload.itemId`) and no longer fall back to generic `id`, preventing feed thumb requests from non-canonical ids.
- 2026-03-27 | other-manual-cover-read-time-privacy-gating | Added backend read-time redaction for `other` manual cover media in `api/controllers/feedController.js` (`GET /api/feed`, `GET /api/feed/:id`) and `api/controllers/shelvesController.js` (`GET /api/manuals/:manualId`): cover fields are now nulled for non-owners when the linked collection item has an owner photo (`vision_crop` or `upload`) but sharing is currently disabled (`owner_photo_visible=false` or `users.show_personal_photos=false`). Feed redaction now also nulls `itemId` references for blocked manual items so clients cannot derive owner-photo thumbnail endpoints from redacted entries. Copy-to-cover writes remain unchanged; schema/contracts unchanged; standalone manual-cover-only items without linked owner photo remain visible.
- 2026-03-27 | owner-photo-privacy-manual-promotion-guard | Hardened `shelvesController.attachCropToCollectionItem` so `other`-shelf crop-to-manual cover promotion only runs when crop attach succeeds and the attached owner photo is both `vision_crop` and share-enabled (`owner_photo_visible = true`). Added regression tests in `api/__tests__/shelvesController.test.js` for share-off skip and share-on promotion behavior.
- 2026-03-26 | vision-crop-warmup-blocking | Changed crop warmup in `shelvesController.processShelfVision` from fire-and-forget (`queueVisionCropWarmup` via `setImmediate`) to blocking (`await warmVisionScanCrops`) before `processingStatus.completeJob`, so crop photos are generated and attached to shelf items before the mobile client sees 100% completion. Added `generatingPhotos` progress step at 95% in `api/config/visionProgressMessages.json`. Both async and sync vision processing paths updated. No mobile code changes required â€” existing polling naturally handles the new progress step.
- 2026-03-26 | feed-added-event-visual-refresh | Refined added-event system end-to-end for shelf posts. API now standardizes `item.collectable_added` / `item.manual_added` payloads across `shelvesController` and `visionPipeline` with normalized title/name, creator, year, media fields, ids, and source metadata; feed mapping in `feedController` now exposes top-level `title`/`creator`/`year` for added items in both `GET /api/feed` and `GET /api/feed/:id`, and feed-detail item hydration now selects collectable year. Mobile added new shared helper `mobile/src/utils/feedAddedEvent.js` and updated `SocialFeedScreen`, `ProfileScreen`, and `FeedDetailScreen` to use dynamic shelf-type header copy, remove shelf-description body usage in added cards, render single-item detail rows (thumbnail + name/creator/year), preserve multi-item stacked thumbnails, and show `other` shelf owner-photo thumbnails with placeholder fallback when unavailable.
- 2026-03-26 | mobile-navigation-manual-edit-nested-setparams-target-fix | Fixed manual-edit return updates across nested navigation by passing `detailNavigatorKey` from `CollectableDetailScreen` into `ManualEditScreen` and dispatching `CommonActions.setParams` with both `source` (`detailRouteKey`) and `target` (`detailNavigatorKey`), preventing unhandled `SET_PARAMS` warnings when detail is mounted inside the nested Shelves stack.
- 2026-03-26 | mobile-navigation-manual-edit-close-behavior-fix | Updated `ManualEditScreen` save flow to dispatch `CommonActions.setParams` to the existing `CollectableDetail` route via `detailRouteKey` (instead of `navigate(...)`), so save updates detail params without pushing/focusing another route and `goBack()` reliably closes the edit screen.
- 2026-03-26 | mobile-navigation-manual-edit-save-route-fix | Fixed `ManualEditScreen` save flow to include route `name: 'CollectableDetail'` in object-form `navigation.navigate(...)` when targeting `detailRouteKey`, resolving React Navigation runtime error requiring a route name for object arguments.
- 2026-03-26 | mobile-navigation-add-to-shelf-nested-route-fix | Fixed `BottomTabNavigator` add-to-shelf FAB navigation to target the actual nested navigator path (`Main -> Shelves -> ShelfSelect`) when persistent shelves footer mode is enabled, replacing the invalid direct `navigate('Shelves', { screen: 'ShelfSelect' })` dispatch.
- 2026-03-26 | market-value-ui-enhancements | Added market value estimate feature: new `user_market_value_estimates` DB table (migration `20260326000000`), new query module `database/queries/marketValueEstimates.js`, three new API endpoints on `/api/collectables/:id` (`market-value-sources` GET, `user-estimate` GET/PUT â€” all support `?type=manual` for `user_manuals` items), new `MarketValueSourcesScreen` (registered in App.js root stack + BottomTabNavigator ShelvesTabStack). Updated `CollectableDetailScreen` to show "Est. Market Value" label with clickable navigation to sources screen in both the manual (`manualEditableFields`) and collectable (`preferredKeys`) metadata paths, and appends user estimate as "Your Estimate" metadata row when present. User estimate fetch supports both collectable and manual items via `?type=manual` query param.
- 2026-03-26 | collectable-detail-replace-cta-layout | Updated `CollectableDetailScreen` header actions so the manual-entry edit pencil no longer gets displaced when the vision-linked replacement CTA is present: the `Not the item you intended to add?` CTA now renders in its own row beneath the header while manual edit access remains in the right header action slot.
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
- 2026-03-23 | vision-workflow | Joined enrichment requests to original Gemini vision extraction using multi-turn chat sessions (`startChat`/`sendMessage`). `detectShelfItemsFromImage()` now returns `{ items, conversationHistory }`. `enrichWithSchema()` and `enrichWithSchemaUncertain()` accept optional `conversationHistory` param â€” when provided and vision/text models match, enrichment continues the chat session (image context preserved). "Other" shelf search enrichment also uses chat mode. New private helper `_executeEnrichmentRequest()` handles chat-vs-standalone branching. `visionPipeline.js` threads `conversationHistory` from `extractItems()` through `processImage()` to both enrichment calls. Fully backward-compatible (MLKit rawItems path, model mismatch, enrichment disabled all fall back to standalone mode).
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
- 2026-03-26 | website-seo | Generated static `sitemap.xml` for website and documented existing website routes (`about`, `books`, `collectibles`, `how-it-works`, `movies`, `privacy`, `video-games`, `vinyl`) in DependencyTree.md.

---

## Cross-Component Dependencies

### API â†” Mobile Contract

| Mobile Service | API Route | Auth |
|---|---|---|
| `services/api.js` (apiRequest) | All `/api/*` endpoints | Bearer JWT |
| `services/feedApi.js` | `/api/feed/:eventId/like`, `/api/feed/:eventId/comments` | Bearer JWT |
| `services/newsApi.js` | `/api/discover/dismiss` | Bearer JWT |
| `services/pushNotifications.js` | `/api/push/register`, `/api/push/unregister`, `/api/push/preferences` | Bearer JWT |
| `services/ocr.js` | (on-device only, no API call) | N/A |
| `services/imageUpload.js` | (prepares assets only, upload via apiRequest) | N/A |

#### Vision Workflow Completion Contract (`mobile` <- `api`)

- `POST /api/shelves/:shelfId/vision` (sync complete path) includes:
  - `addedCount`
  - `needsReviewCount`
  - `existingCount`
  - `extractedCount`
  - `summaryMessage`
  - optional `cached` boolean (true when same-photo idempotency served a cached result)
- `POST /api/shelves/:shelfId/vision` (async path) now returns:
  - `status` in `{queued, processing, completed}`
  - `queuePosition` (nullable integer)
  - `estimatedWaitSeconds` (nullable integer)
  - `notifyOnComplete` (boolean)
  - existing async payload fields (`jobId`, `scanPhotoId`, `queued`, `message`)
- `GET /api/shelves/:shelfId/vision/:jobId/status` now includes:
  - queue metadata (`queuePosition`, `queuedMs`, `estimatedWaitSeconds`, `notifyOnComplete`)
  - progress payload (`status`, `step`, `progress`, `message`)
  - terminal payload (`result`) including:
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

#### Game Platform Ownership Contract (`mobile` <- `api`)

- Shelf item payloads (`GET /api/shelves/:shelfId/items`, detail hydration) now include:
  - `collectable.platformData: PlatformData[]`
  - `collectable.platforms: string[]` (derived convenience names)
  - `collectable.maxPlayers: number | null` (games only; derived from IGDB multiplayer metadata when available)
  - `ownedPlatforms: string[]` (user-owned consoles for that shelf item)
- New owner-only endpoint:
  - `PUT /api/shelves/:shelfId/items/:itemId/platforms`
  - body: `{ platforms: string[] }`
  - response: updated shelf item payload including `ownedPlatforms`

#### Shelf Photo Contract (`mobile` <- `api`)

- Shelf payloads returned from `GET /api/shelves`, `GET /api/shelves/:shelfId`, `POST /api/shelves`, and `PUT /api/shelves/:shelfId` now include:
  - `shelfPhoto`: `{ hasPhoto, contentType, sizeBytes, width, height, updatedAt, imageUrl }`
  - `imageUrl` resolves to `/api/shelves/:shelfId/photo/image` when `hasPhoto=true`.
- New shelf photo endpoints:
  - `GET /api/shelves/:shelfId/photo` -> metadata-only `shelfPhoto` payload.
  - `GET /api/shelves/:shelfId/photo/image` -> authenticated binary image payload.
  - `POST /api/shelves/:shelfId/photo` (multipart `photo`) -> updated `shelfPhoto`.
  - `DELETE /api/shelves/:shelfId/photo` -> cleared `shelfPhoto` (`hasPhoto=false`).

#### Push Notification Contract (`mobile` <- `api`)

- `GET /api/push/preferences` and `PATCH /api/push/preferences` now include `pushWorkflowJobs`.
- `GET /api/notifications` may return workflow queue terminal types:
  - `type` in `{workflow_complete, workflow_failed}`
  - `entityType = workflow_job`
  - metadata includes `workflowType`, `shelfId`, `summaryMessage`.
- Consumer paths:
  - `mobile/src/screens/NotificationSettingsScreen.js` exposes `Workflow Jobs` toggle.
  - `mobile/src/screens/NotificationScreen.js` renders workflow-specific notification copy.
  - `mobile/src/context/PushContext.js` routes workflow notifications to `ShelfDetail` when `metadata.shelfId` exists.

### API â†” Admin Dashboard Contract

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
| `toggleUnlimitedVisionTokens(userId)` | `POST /api/admin/users/:userId/toggle-unlimited-vision` | Cookie + CSRF |
| `getUserVisionQuota(userId)` | `GET /api/admin/users/:userId/vision-quota` | Cookie |
| `resetUserVisionQuota(userId)` | `POST /api/admin/users/:userId/vision-quota/reset` | Cookie + CSRF |
| `setUserVisionQuota(userId, quota)` | `PUT /api/admin/users/:userId/vision-quota` | Cookie + CSRF |
| `getRecentFeed(params)` | `GET /api/admin/feed/recent` | Cookie |
| `getJobs(params)` | `GET /api/admin/jobs` | Cookie |
| `getJob(jobId)` | `GET /api/admin/jobs/:jobId` | Cookie |
| `getWorkfeed(params)` | `GET /api/admin/workfeed` | Cookie |
| `getWorkfeedJob(jobId)` | `GET /api/admin/workfeed/:jobId` | Cookie |
| `getAuditLogs(params)` | `GET /api/admin/audit-logs` | Cookie |
| `getSettings()` | `GET /api/admin/settings` | Cookie |
| `updateSetting(key, value, desc)` | `PUT /api/admin/settings/:key` | Cookie + CSRF |
| `getShelves(params)` | `GET /api/admin/shelves` | Cookie |
| `getShelf(shelfId)` | `GET /api/admin/shelves/:shelfId` | Cookie |
| `getShelfItems(shelfId, params)` | `GET /api/admin/shelves/:shelfId/items` | Cookie |

### API â†” Website Contract

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
  -> api/server.js
  -> api/logger.js
  -> api/database/pg.js
  -> api/services/newsCacheScheduler.js
  -> api/services/newsSeenCleanupScheduler.js

api/server.js
  -> api/routes/resetPasswordPage.js
  -> api/routes/auth.js
  -> api/routes/shelves.js
  -> api/routes/account.js
  -> api/routes/collectables.js
  -> api/routes/feed.js
  -> api/routes/friends.js
  -> api/routes/profile.js
  -> api/routes/wishlists.js
  -> api/routes/favorites.js
  -> api/routes/lists.js
  -> api/routes/unmatched.js
  -> api/routes/onboarding.js
  -> api/routes/config.js
  -> api/routes/checkin.js
  -> api/routes/notifications.js
  -> api/routes/ratings.js
  -> api/routes/discover.js
  -> api/routes/push.js
  -> api/routes/admin.js
  -> api/routes/manuals.js
  -> api/routes/waitlist.js
  -> api/routes/share.js
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

api/__tests__/collectableMatchingService.test.js
  -> api/services/collectableMatchingService.js
  -> api/services/catalog/sharedCatalogServices.js
  -> api/services/catalog/MetadataScorer.js

api/database/queries/jobRuns.test.js
  -> api/database/queries/jobRuns.js
  -> api/database/pg.js
```

### Routes -> Controllers -> Queries/Services

#### auth
```
routes/auth.js
  -> controllers/authController.js
  -> middleware/auth.js
  -> middleware/validate.js
  Routes: POST /login (consumer username-or-email via `username` field), /register, /refresh, /forgot-password, /reset-password; GET /me, /validate-reset-token

controllers/authController.js
  -> database/queries/auth.js
  -> database/queries/passwordReset.js
  -> services/emailService.js
  -> utils/adminAuth.js
```

#### shelves
```
routes/shelves.js
  -> includes GET/POST/DELETE shelf photo endpoints (`/:shelfId/photo`, `/:shelfId/photo/image`)
  -> includes POST /:shelfId/items/:itemId/replacement-intent, POST /:shelfId/items/:itemId/replace, PUT /:shelfId/items/:itemId/details, and PUT /:shelfId/items/:itemId/platforms
  -> route-level express-rate-limit ingress guards on `POST /:shelfId/vision` and `POST /:shelfId/catalog-lookup`
  -> controllers/shelvesController.js
  -> middleware/auth.js
  -> middleware/imageUploadErrorHandler.js
  -> middleware/validate.js
  -> middleware/workflowJobContext.js (vision/catalog workflow routes only)
  -> express-rate-limit
  -> utils/imageValidation.js

controllers/shelvesController.js
  -> database/queries/itemReplacementTraces.js
  -> database/pg.js
  -> database/queries/shelves.js
  -> database/queries/collectables.js
  -> database/queries/feed.js
  -> database/queries/utils.js
  -> database/queries/needsReview.js
  -> database/queries/visionQuota.js
  -> database/queries/visionResultCache.js
  -> database/queries/manualMedia.js
  -> database/queries/shelfPhotos.js
  -> database/queries/userCollectionPhotos.js
  -> database/queries/visionScanPhotos.js
  -> database/queries/visionItemRegions.js
  -> database/queries/visionItemCrops.js
  -> database/queries/workflowQueueJobs.js
  -> services/collectables/fingerprint.js
  -> services/collectableMatchingService.js
  -> services/catalog/BookCatalogService.js
  -> services/catalog/MovieCatalogService.js
  -> services/catalog/GameCatalogService.js
  -> @shelvesai/vision-crops (createVisionCropService)
  -> services/gameShelfDefaults.js
  -> services/visionPipeline.js
  -> services/visionPipelineHooks.js
  -> services/processingStatus.js
  -> services/workflowQueueService.js
  -> services/workflow/workflowSettings.js
  -> services/mediaUrl.js
  -> services/manuals/otherManual.js
  -> utils/imageValidation.js
  -> utils/normalize.js
  -> config/constants.js
```

#### feed
```
routes/feed.js
  -> controllers/feedController.js
  -> controllers/eventSocialController.js
  -> middleware/auth.js
  -> middleware/validate.js

controllers/feedController.js
  -> database/pg.js
  -> database/queries/feed.js
  -> database/queries/shelves.js
  -> database/queries/friendships.js
  -> database/queries/eventSocial.js
  -> database/queries/newsSeen.js
  -> database/queries/utils.js
  -> services/discovery/newsRecommendations.js
  -> services/mediaUrl.js
  -> config/constants.js

controllers/eventSocialController.js
  -> database/queries/eventSocial.js
  -> database/queries/notifications.js
  -> database/queries/friendships.js
  -> database/queries/users.js
  -> database/queries/utils.js
```

#### friends
```
routes/friends.js
  -> controllers/friendController.js
  -> middleware/auth.js
  -> middleware/validate.js

controllers/friendController.js
  -> database/pg.js
  -> database/queries/friendships.js
  -> database/queries/notifications.js
  -> database/queries/utils.js
  -> services/mediaUrl.js
```

#### profile
```
routes/profile.js
  -> controllers/profileController.js
  -> middleware/auth.js
  -> middleware/validate.js
  -> utils/imageValidation.js

controllers/profileController.js
  -> database/pg.js
  -> database/queries/users.js
  -> database/queries/shelves.js
  -> database/queries/profileMedia.js
  -> database/queries/utils.js
  -> services/mediaUrl.js
  -> utils/imageValidation.js
```

#### account
```
routes/account.js
  -> controllers/accountController.js
  -> middleware/auth.js
  -> middleware/validate.js
  Endpoints: GET /api/account, PUT /api/account, POST /api/account/feedback

controllers/accountController.js
  -> database/pg.js
  -> database/queries/utils.js
  -> database/queries/visionQuota.js
  -> services/mediaUrl.js
  -> services/emailService.js
  Allowed update fields: first_name, last_name, phone_number, country, city, state, is_private, is_premium, picture, show_personal_photos
  Guards: checks req.user.premiumLockedByAdmin before allowing is_premium update
```

#### collectables
```
routes/collectables.js
  -> middleware/auth.js
  -> middleware/admin.js
  -> middleware/validate.js
  -> database/queries/collectables.js
  -> database/pg.js
  -> database/queries/utils.js
  -> services/collectables/fingerprint.js
  -> services/collectables/kind.js
  -> utils/normalize.js
  ->database/queries/marketValueEstimates.js
  Endpoints: GET /api/collectables (supports fallbackApi/fallbackLimit/apiSupplement/type/platform and provider-level fallback paging via offset; local games platform filtering uses `system_name` + `platform_data`; game responses include derived `maxPlayers` when available), POST /api/collectables/resolve-search-hit, GET /:collectableId/market-value-sources, GET /:collectableId/user-estimate, PUT /:collectableId/user-estimate
```

#### share
```
routes/share.js
  -> database/pg.js
  -> services/mediaUrl.js
  -> logger.js
  Public endpoints:
    GET /api/share/collectables/:id
    GET /api/share/manuals/:id
    GET /api/share/shelves/:id
    GET /api/share/events/:id
    GET /api/share/profiles/:username
  Response contract:
    visibility, entityType, id, slug, title, description, imageUrl, canonicalUrl, appUrl
```

#### wishlists
```
routes/wishlists.js
  -> controllers/wishlistController.js
  -> middleware/auth.js
  -> middleware/validate.js

controllers/wishlistController.js
  -> database/queries/wishlists.js
```

#### favorites
```
routes/favorites.js
  -> controllers/favoritesController.js
  -> middleware/auth.js
  -> middleware/validate.js

controllers/favoritesController.js
  -> database/queries/favorites.js
  -> database/queries/collectables.js
  -> database/queries/feed.js
  -> database/queries/users.js
  -> database/queries/friendships.js
  -> database/queries/shelves.js
  -> services/mediaUrl.js
  -> utils/errorHandler.js
```

#### lists
```
routes/lists.js
  -> controllers/listsController.js
  -> middleware/auth.js
  -> middleware/validate.js

controllers/listsController.js
  -> database/queries/lists.js
  -> database/queries/collectables.js
  -> database/queries/feed.js
```

#### ratings
```
routes/ratings.js
  -> controllers/ratingsController.js
  -> middleware/auth.js
  -> middleware/validate.js

controllers/ratingsController.js
  -> database/queries/ratings.js
  -> database/queries/marketValueEstimates.js
  -> database/queries/collectables.js
  -> database/queries/shelves.js
  -> database/queries/feed.js
  -> services/mediaUrl.js
```

#### notifications
```
routes/notifications.js
  -> controllers/notificationController.js
  -> middleware/auth.js
  -> middleware/validate.js

controllers/notificationController.js
  -> database/queries/notifications.js
  -> database/queries/utils.js
```

#### push
```
routes/push.js
  -> controllers/pushController.js
  -> middleware/auth.js

controllers/pushController.js
  -> database/queries/pushDeviceTokens.js
  -> database/queries/notificationPreferences.js
  -> services/pushNotificationService.js
```

#### discover
```
routes/discover.js
  -> controllers/discoverController.js
  -> middleware/auth.js

controllers/discoverController.js
  -> database/pg.js
  -> database/queries/newsDismissed.js
  -> database/queries/utils.js
  -> utils/errorHandler.js
```

#### unmatched
```
routes/unmatched.js
  -> middleware/auth.js
  -> middleware/validate.js
  -> database/queries/needsReview.js
  -> database/queries/shelves.js
  -> database/queries/collectables.js
  -> services/collectables/fingerprint.js
  -> services/manuals/otherManual.js
  -> services/collectableMatchingService.js (lazy require)
```

#### checkin
```
routes/checkin.js
  -> middleware/auth.js
  -> middleware/validate.js
  -> database/queries/feed.js
  -> database/queries/collectables.js
  -> database/pg.js
  -> database/queries/utils.js
  -> routes/collectables.js (_helpers: API fallback/container resolution helpers)

Mobile check-in flows that resolve external items before POST /api/checkin:
  CheckInScreen       -> POST /api/collectables/resolve-search-hit (auth only)
  QuickCheckInModal   -> POST /api/collectables/from-news (auth only)
```

#### onboarding
```
routes/onboarding.js
  -> controllers/onboardingController.js
  -> middleware/auth.js

controllers/onboardingController.js
  -> database/queries/users.js
  -> database/queries/utils.js
```

#### admin
```
routes/admin.js
  -> controllers/adminController.js
  -> controllers/authController.js
  -> middleware/auth.js
  -> middleware/admin.js
  -> middleware/csrf.js
  -> middleware/validate.js
  Routes (read, before CSRF):
    GET  /stats, /stats/detailed, /users, /feed/recent, /jobs, /jobs/:jobId
    GET  /workfeed, /workfeed/:jobId
    GET  /settings, /users/:userId/vision-quota, /audit-logs
    GET  /shelves, /shelves/:shelfId, /shelves/:shelfId/items
  Routes (write, after CSRF):
    PUT  /settings/:key, /users/:userId/vision-quota
    POST /users/:userId/suspend, /unsuspend, /toggle-admin, /toggle-premium, /toggle-unlimited-vision
    POST /users/:userId/vision-quota/reset

controllers/adminController.js
  -> database/queries/admin.js
  -> database/queries/jobRuns.js
  -> database/queries/workflowQueueJobs.js
  -> database/queries/systemSettings.js
  -> database/queries/visionQuota.js
  -> database/queries/adminContent.js
  -> services/processingStatus.js
  -> services/config/SystemSettingsCache.js
  -> database/queries/utils.js
  -> utils/adminAuth.js
```

#### manuals
```
routes/manuals.js
  -> controllers/shelvesController.js
  -> middleware/auth.js
  -> middleware/validate.js
```

#### config
```
routes/config.js
  (reads config/onboardingScreen.json via fs)
```

#### waitlist
```
routes/waitlist.js
  -> middleware/validate.js
  -> resend (Contacts API)
```

#### resetPasswordPage
```
routes/resetPasswordPage.js
  (no internal imports â€” serves reset-password web fallback + app deep-link bridge)
```

### Middleware Internal Dependencies

```
middleware/auth.js
  -> database/pg.js
  -> context.js
  -> utils/adminAuth.js
  -> config/constants.js
  Selects: is_premium, premium_locked_by_admin -> sets req.user.premiumLockedByAdmin

middleware/admin.js
  (no internal imports)

middleware/validate.js
  (no internal imports)

middleware/imageUploadErrorHandler.js
  -> multer

middleware/csrf.js
  -> utils/adminAuth.js

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
  -> services/googleGemini.js
  -> services/processingStatus.js
  -> services/visionPipelineHooks.js
  -> services/gameShelfDefaults.js
  -> services/visionScout.js
  -> services/visionSlicer.js
  -> services/visionCropper.js (extractRegionCrop for scout region crops)
  -> services/collectables/fingerprint.js
  -> services/collectables/kind.js
  -> services/catalog/sharedCatalogServices.js
  -> services/manuals/otherManual.js
  -> database/pg.js
  -> database/queries/collectables.js
  -> database/queries/shelves.js
  -> database/queries/needsReview.js
  -> database/queries/feed.js
  -> database/queries/visionItemRegions.js
  -> config/constants.js
  -> config/visionSettings.json
  -> utils/visionBox2d.js
  Data flow: extractItems() -> { items, conversationHistory, warning }
             when VISION_SCOUT_ENABLED=true (non-other shelves): runScoutPhase() -> runSliceDetectionPhase()/runSingleRegionDetection()
             scout phase sends multi-region prefilter prompt via GoogleGeminiService.sendScoutPrompt()
             slice phase computes vertical slices, runs extractItems() per slice, remaps coords, deduplicates by IoU
             crowded `other` scans (>10 items by default) run `googleGemini.refineDenseItemBoxes()` before first region persistence
             processImage() threads conversationHistory to enrichUnresolved/enrichUncertain
             processImage() appends extraction warning to `warnings` payload when present
             processImage(options.scanPhotoDimensions) normalizes/repairs bbox before persistence
             persistVisionRegions(...) uses replaceExisting snapshot semantics per scanPhotoId

services/visionScout.js
  -> utils/visionBox2d.js (normalizeVisionBox2d for scout response box validation)
  Scout prompt construction and response parsing for image layout prefilter
  Exports: buildScoutPrompt, buildMultiRegionScoutPrompt, parseScoutResponse, parseMultiRegionScoutResponse

services/visionSlicer.js
  -> utils/visionBox2d.js (normalizeVisionBox2d, BOX_SCALE for coordinate remapping)
  Vertical slice computation, buffer extraction via sharp, coordinate remapping, cross-slice IoU deduplication
  Exports: computeSliceRects, extractSliceBuffers, remapBox2dFromSlice, computeIou, deduplicateSliceDetections

services/gameShelfDefaults.js
  (no internal imports â€” shared games defaults validation/normalization + mismatch resolver)

services/visionPipelineHooks.js
  (no internal imports â€” hook registry)

services/processingStatus.js
  (no internal imports â€” in-memory Map)

services/googleGemini.js
  -> config/visionSettings.json
  -> services/outboundLimiterRegistry.js
  -> utils/visionBox2d.js
  Methods: detectShelfItemsFromImage() -> { items, conversationHistory, warning }
             "other" shelves: single call with tools: [{ googleSearch: {} }] for search grounding
             standard shelves: vision-only call, enrichment downstream
             transport/provider request failures throw `VISION_PROVIDER_UNAVAILABLE`/`VISION_EXTRACTION_FAILED`
             truncated JSON extraction responses are repaired to salvage complete items
           sendScoutPrompt(base64Image, scoutPrompt, options?) -> string (raw response text)
             lightweight prefilter call for image layout metadata, no googleSearch, retries once on transient failure
           refineDenseItemBoxes(base64Image, shelfType, items, conversationHistory?, options?) -> Map<extractionIndex, box2d>
             batched crowded-shelf geometry-only refinement, no `googleSearch`, ignores invalid boxes
           enrichWithSchema(items, shelfType, conversationHistory?)
           enrichWithSchemaUncertain(items, shelfType, conversationHistory?)
           _executeEnrichmentRequest(prompt, conversationHistory, label, options?)
  Chat mode: uses @google/generative-ai startChat({ history }) + sendMessage()
             when conversationHistory is available and visionModel === textModel

services/googleCloudVision.js
  (no internal imports â€” disabled)

### Local Packages

```
@shelvesai/vision-crops@1.0.0 (installed from packages/shelvesai-vision-crops-1.0.0.tgz)
  lib/visionBox2d.js   — bbox normalization, coordinate modes, padding, polygon/quad geometry
  lib/visionCropper.js — Sharp crop extraction, crop rect computation
  lib/service.js       — region crop retrieval/listing, warmup queue-pressure logic,
                          crop attachment/manual-cover promotion hooks, review relinking orchestration
  Dependency: sharp (peer, resolved from consuming app)

@shelvesai/vision-core@1.0.0 (tarball at packages/shelvesai-vision-core-1.0.0.tgz, NOT installed)
  Reference-only: geminiDetector.js, verticalSlices.js, visionService.js patterns
  replicated in ShelvesAI's own visionScout.js/visionSlicer.js/visionPipeline.js
```

services/visionCropper.js
  -> @shelvesai/vision-crops
  Thin API compatibility wrapper that injects the API logger into `extractRegionCrop()`

services/shelfImageUpload.js
  -> utils/imageValidation.js
  -> sharp
  Auto-orients oversized shelf-related uploads and resizes only when an image exceeds the shared 4096px bound

services/collectableMatchingService.js
  -> database/queries/collectables.js
  -> services/collectables/fingerprint.js
  -> services/catalog/sharedCatalogServices.js
  -> services/catalog/MetadataScorer.js
  -> services/config/shelfTypeResolver.js

services/collectables/fingerprint.js
  (no internal imports â€” crypto hashing)

services/collectables/kind.js
  -> services/config/shelfTypeResolver.js

services/config/shelfTypeResolver.js
  -> config/shelfType.json

services/catalog/BookCatalogService.js
  -> services/catalog/CatalogRouter.js
  -> services/openLibrary.js
  -> services/hardcover.js
  -> adapters/openlibrary.adapter.js
  -> adapters/hardcover.adapter.js

services/catalog/MovieCatalogService.js
  -> services/catalog/CatalogRouter.js
  -> services/catalog/adapters/TmdbAdapter.js
  -> services/outboundLimiterRegistry.js

services/catalog/GameCatalogService.js
  -> services/catalog/CatalogRouter.js
  -> services/catalog/adapters/IgdbAdapter.js
  -> services/outboundLimiterRegistry.js

services/catalog/TvCatalogService.js
  -> services/catalog/CatalogRouter.js
  -> services/catalog/adapters/TmdbTvAdapter.js
  -> services/outboundLimiterRegistry.js

services/catalog/MusicCatalogService.js
  -> services/collectables/fingerprint.js
  -> adapters/musicbrainz.adapter.js
  -> services/config/shelfTypeResolver.js
  -> services/catalog/MusicBrainzRequestQueue.js
  -> services/catalog/CatalogRouter.js (lazy require)

services/catalog/MusicBrainzRequestQueue.js
  (no internal imports â€” FIFO request queue)

services/catalog/sharedCatalogServices.js
  -> services/catalog/BookCatalogService.js
  -> services/catalog/MovieCatalogService.js
  -> services/catalog/GameCatalogService.js
  -> services/catalog/TvCatalogService.js
  -> services/catalog/MusicCatalogService.js

services/catalog/CoverArtBackfillHook.js
  -> services/visionPipelineHooks.js (lazy require in register())

services/catalog/CatalogRouter.js
  -> config/apiContainers.json
  -> services/catalog/MetadataScorer.js

services/catalog/MetadataScorer.js
  -> config/metadataScoreConfig.json
  -> services/config/SystemSettingsCache.js

services/catalog/metadataScore.js
  -> services/catalog/MetadataScorer.js

services/config/SystemSettingsCache.js
  -> database/queries/systemSettings.js (lazy require, cache miss only)

services/catalog/adapters/TmdbAdapter.js
  -> utils/RateLimiter.js

services/catalog/adapters/TmdbTvAdapter.js
  -> utils/RateLimiter.js

services/catalog/adapters/IgdbAdapter.js
  -> utils/RateLimiter.js

services/catalog/adapters/MusicBrainzAdapter.js
  -> services/collectables/fingerprint.js
  -> adapters/musicbrainz.adapter.js
  -> utils/withTimeout.js
  -> services/catalog/MusicCatalogService.js (lazy require)

services/catalog/adapters/DiscogsAdapter.js
  -> services/collectables/fingerprint.js
  -> adapters/discogs.adapter.js
  -> utils/withTimeout.js
  -> utils/RateLimiter.js

services/openLibrary.js
  -> services/outboundLimiterRegistry.js

services/hardcover.js
  -> services/outboundLimiterRegistry.js
  -> utils/RateLimiter.js

services/emailService.js
  -> logger.js
  (uses resend)

services/pushNotificationService.js
  (no internal imports â€” uses expo-server-sdk)

services/s3.js
  -> services/outboundLimiterRegistry.js
  (uses @aws-sdk/client-s3)

services/outboundLimiterRegistry.js
  -> logger.js

services/workflowQueueService.js
  -> database/queries/workflowQueueJobs.js
  -> database/queries/notifications.js
  -> services/workflow/workflowSettings.js
  -> services/processingStatus.js
  -> logger.js

services/workflow/workflowSettings.js
  -> services/config/SystemSettingsCache.js

services/mediaUrl.js
  (no internal imports)

services/manuals/otherManual.js
  (no internal imports)

services/newsCacheScheduler.js
  -> jobs/refreshNewsCache.js
  -> utils/jobRunner.js

services/newsSeenCleanupScheduler.js
  -> database/queries/newsSeen.js
  -> utils/jobRunner.js

services/discovery/newsRecommendations.js
  -> database/pg.js
  -> database/queries/newsSeen.js

services/discovery/CollectableDiscoveryHook.js
  -> database/queries/collectables.js
  -> services/collectables/fingerprint.js

services/discovery/TmdbDiscoveryAdapter.js
  -> utils/RateLimiter.js

services/discovery/IgdbDiscoveryAdapter.js
  -> utils/RateLimiter.js

services/discovery/BlurayDiscoveryAdapter.js
  (uses cheerio for scraping)

services/discovery/NytBooksDiscoveryAdapter.js
  (no internal imports)
```

### Jobs Internal Dependencies

```
jobs/refreshNewsCache.js
  -> services/discovery/TmdbDiscoveryAdapter.js
  -> services/discovery/IgdbDiscoveryAdapter.js
  -> services/discovery/BlurayDiscoveryAdapter.js
  -> services/discovery/NytBooksDiscoveryAdapter.js
  -> database/pg.js

jobs/resetAndRefreshNewsCache.js
  -> jobs/refreshNewsCache.js

jobs/refreshCollectableMetadata.js
  -> services/catalog/* (catalog services)

jobs/refreshTmdbCoverCache.js
  -> services/s3.js

jobs/cleanupNeedsReview.js
  -> database/pg.js
```

### Scripts Internal Dependencies

```
scripts/backfillMetascore.js
  -> database/pg.js
  -> services/catalog/MetadataScorer.js
  -> services/config/shelfTypeResolver.js
  -> database/queries/utils.js

scripts/backfill-missing-cover-media.js
  -> database/pg.js
  -> database/queries/media.js
  -> logger.js

scripts/get-bearer-token.ps1
  (standalone PowerShell HTTP client for local auth token retrieval)

scripts/audit-login-identifier-collisions.js
  -> database/pg.js
  -> logger.js
  Behavior: audits cross-user collisions where `LOWER(users.username) = LOWER(other_user.email)` so consumer username-or-email login can fail safely on ambiguous identifiers

scripts/fetch-api-payload.ps1
  (standalone PowerShell HTTP client for authenticated API payload retrieval)

scripts/backfill-collectable-platform-data.js
  Ã¢â€ â€™ database/pg.js
  Ã¢â€ â€™ database/queries/collectables.js
  Ã¢â€ â€™ services/catalog/GameCatalogService.js
  Ã¢â€ â€™ logger.js
  Behavior: loads `.env` then `.env.local` override when available; backfills `platform_data`, `igdb_payload`, and `max_players` for IGDB-linked games

scripts/stamp-local-knex-migrations.js
  → loadEnv.js
  → logger.js
  Behavior: localhost-only helper that stamps all current migration `.js` filenames into `knex_migrations` for schema-snapshot local DBs so future `knex migrate:latest` runs do not replay already-materialized baseline tables

scripts/patch-local-user-favorites-manual-id.js
  → loadEnv.js
  → logger.js
  Behavior: localhost-only helper that patches `user_favorites` to add `manual_id`, relaxes `collectable_id` nullability, and recreates the expected favorites constraints/indexes used by manual favorites queries
```

### Database Query Dependencies

```
database/pg.js
  (no internal imports â€” pg Pool singleton)

database/queries/utils.js
  (no internal imports â€” pure helpers)

database/queries/auth.js -> database/pg.js, database/queries/utils.js, logger.js
database/queries/shelves.js -> database/pg.js, database/queries/utils.js
database/queries/itemReplacementTraces.js -> database/pg.js, database/queries/utils.js
database/queries/collectables.js -> database/pg.js, database/queries/utils.js, database/queries/media.js, services/collectables/kind.js, database/queries/jobRuns.js, context.js
database/queries/feed.js -> database/pg.js, database/queries/utils.js, config/constants.js
database/queries/eventSocial.js -> database/pg.js, database/queries/utils.js
database/queries/friendships.js -> database/pg.js, database/queries/utils.js
database/queries/users.js -> database/pg.js, database/queries/utils.js
database/queries/notifications.js -> database/pg.js, database/queries/utils.js
database/queries/needsReview.js -> database/pg.js, database/queries/utils.js
database/queries/wishlists.js -> database/pg.js, database/queries/utils.js
database/queries/favorites.js -> database/pg.js, database/queries/utils.js
database/queries/lists.js -> database/pg.js, database/queries/utils.js
database/queries/ratings.js -> database/pg.js, database/queries/utils.js
database/queries/ownership.js -> database/pg.js
database/queries/media.js -> database/pg.js, services/s3.js, utils/imageValidation.js
database/queries/manualMedia.js -> database/pg.js, services/s3.js, services/shelfImageUpload.js
database/queries/userCollectionPhotos.js -> database/pg.js, services/s3.js, services/shelfImageUpload.js, database/queries/visionItemCrops.js, services/ownerPhotoThumbnail.js
database/queries/shelfPhotos.js -> database/pg.js, services/s3.js, services/shelfImageUpload.js
database/queries/visionScanPhotos.js -> database/pg.js, services/s3.js, utils/imageValidation.js
database/queries/visionItemRegions.js -> database/pg.js, database/queries/utils.js (replaceExisting snapshot delete-before-insert support)
database/queries/visionItemCrops.js -> database/pg.js, services/s3.js
database/queries/profileMedia.js -> database/pg.js, services/s3.js
database/queries/passwordReset.js -> database/pg.js
database/queries/visionQuota.js -> database/pg.js, services/config/SystemSettingsCache.js (lazy, for getMonthlyQuotaAsync)
database/queries/pushDeviceTokens.js -> database/pg.js, database/queries/utils.js
database/queries/notificationPreferences.js -> database/pg.js, database/queries/utils.js
database/queries/workflowQueueJobs.js -> database/pg.js, database/queries/utils.js
database/queries/systemSettings.js -> database/pg.js, database/queries/utils.js
database/queries/newsSeen.js -> database/pg.js
database/queries/newsDismissed.js -> database/pg.js
database/queries/admin.js -> database/pg.js, database/queries/utils.js
database/queries/adminContent.js -> database/pg.js, database/queries/utils.js
```

### Utility Dependencies

```
utils/errorHandler.js       (no internal imports)
utils/normalize.js           (no internal imports)
utils/adminAuth.js           (no internal imports â€” uses crypto)
utils/imageValidation.js     (no internal imports â€” uses file-type, image-size)
utils/withTimeout.js         (no internal imports)
utils/payloadLogger.js       (no internal imports â€” uses fs)
utils/RateLimiter.js         (no internal imports)
utils/visionBox2d.js        -> @shelvesai/vision-crops (thin compatibility re-export for shared bbox normalization helpers)
```

### Adapters

```
adapters/openlibrary.adapter.js  (no internal imports â€” transforms API responses)
adapters/hardcover.adapter.js    (no internal imports)
adapters/tmdb.adapter.js         (no internal imports)
adapters/tmdbTv.adapter.js       (no internal imports)
adapters/musicbrainz.adapter.js  -> services/collectables/fingerprint.js
adapters/discogs.adapter.js      -> services/collectables/fingerprint.js
```

### Config Files (data, not code)

```
config/constants.js              (no internal imports â€” env-backed constants)
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
  -> mobile/src/polyfills/index.js
      -> mobile/src/polyfills/message-channel.js
  -> mobile/src/App.js
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
  -> utils/onboarding.js
  -> components/Toast.js
  -> screens/* (all 33 screens listed below)
```

### Expo / Native Config

```
mobile/app.json
  -> assets/icon.png
  -> assets/splash.png
  -> Android adaptive icon foreground: assets/logo-android.png
  -> Android app-link intent filters for `https://shelvesai.com/app/*` and `/reset-password`

mobile/android/app/src/main/AndroidManifest.xml
  -> launcher icons: @mipmap/ic_launcher, @mipmap/ic_launcher_round
  -> HTTPS and custom-scheme deep link intent filters
  -> Expo updates disabled in native Android manifest metadata

mobile/ios/ShelvesAI/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png
  -> sourced from website/public/logo-v2.png
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

navigation/useBottomFooterLayout.js
  -> @react-navigation/bottom-tabs (BottomTabBarHeightContext)
  -> @react-navigation/native (useNavigation)
  -> react-native-safe-area-context
  Used by footer-visible screens to derive runtime tab/footer clearance and bottom offsets from live tab height + safe-area inset

navigation/linkingConfig.js
  (no internal imports)
```

### Services

```
services/api.js
  (no internal imports â€” leaf node)

services/feedApi.js
  -> services/api.js

services/newsApi.js
  -> services/api.js

services/pushNotifications.js
  -> services/api.js

services/imageUpload.js
  -> expo-image-manipulator
  Shared mobile asset prep for profile photos plus multipart upload normalization of HEIC/HEIF/AVIF and other device-native formats to JPEG

services/ocr.js
  (no internal imports)
```

### Hooks

```
hooks/useSearch.js           (no internal imports)
hooks/useAsync.js            (no internal imports)

hooks/useCollectableSearchEngine.js
  Ã¢â€ â€™ services/api.js
  Ã¢â€ â€™ utils/searchNormalization.js

hooks/useVisionProcessing.js
  -> context/ToastContext.js
  -> services/api.js

hooks/useAuthDebug.js
  -> services/api.js

hooks/useNews.js
  -> context/AuthContext.js
  -> services/api.js

hooks/useShelfDetailSync.js  (no internal imports â€” createContext)
hooks/useFriendSearchSync.js (no internal imports â€” createContext)

hooks/useMentionInput.js
  -> context/AuthContext.js
  -> services/api.js
```

### Components

```
components/Toast.js
  -> context/ThemeContext.js
  -> context/ToastContext.js

components/VisionProcessingModal.js
  -> context/ThemeContext.js

components/ShelfVisionModal.js
  (no internal imports)

components/FooterNav.js
  -> assets/icons/*.png (legacy, likely unused)
```

### UI Components (barrel: components/ui/index.js)

```
ui/AccountSlideMenu.js
  -> context/AuthContext.js
  -> context/ThemeContext.js
  -> ui/Avatar.js

ui/AppLayout.js
  -> ../../../../shared/theme/tokens.js  â† CROSS-COMPONENT

ui/Avatar.js
  -> ui/CachedImage.js
  -> theme/index.js

ui/Badge.js -> theme/index.js
ui/Button.js -> theme/index.js
ui/Card.js -> theme/index.js
ui/Input.js -> theme/index.js
ui/Skeleton.js -> theme/index.js

ui/CachedImage.js
  -> ../../../../shared/theme/tokens.js  â† CROSS-COMPONENT

ui/CategoryIcon.js -> utils/iconConfig.js

ui/EmptyState.js
  -> theme/index.js
  -> ui/Button.js

ui/Grid.js -> ../../../../shared/theme/tokens.js  â† CROSS-COMPONENT
ui/Hero.js -> ../../../../shared/theme/tokens.js  â† CROSS-COMPONENT
ui/ShelfListItem.js -> ../../../../shared/theme/tokens.js  â† CROSS-COMPONENT

ui/StarRating.js -> context/ThemeContext.js

ui/GlobalSearchBar.js
  -> context/AuthContext.js
  -> context/ThemeContext.js
  -> services/api.js
  exports: useGlobalSearch (hook), GlobalSearchInput, GlobalSearchOverlay

ui/MentionSuggestions.js
  -> context/ThemeContext.js
```

### News Components

```
components/news/NewsFeed.js
  -> context/ThemeContext.js
  -> hooks/useNews.js
  -> components/news/NewsSection.js
  -> components/news/QuickCheckInModal.js

components/news/NewsSection.js
  -> context/ThemeContext.js
  -> components/news/NewsCard.js

components/news/NewsCard.js
  -> components/ui/CachedImage.js
  -> context/ThemeContext.js

components/news/QuickCheckInModal.js
  -> context/ThemeContext.js
  -> context/ToastContext.js
  -> context/AuthContext.js
  -> services/api.js
```

### Screens -> Internal Dependencies

| Screen | Imports |
|---|---|
| LoginScreen | AuthContext, ThemeContext, api, utils/onboarding |
| ForgotPasswordScreen | AuthContext, ThemeContext, api |
| ResetPasswordScreen | AuthContext, ThemeContext, api |
| OnboardingPagerScreen | AuthContext, ThemeContext, api |
| UsernameSetupScreen | AuthContext, ThemeContext, api |
| OnboardingProfileRequiredScreen | AuthContext, ThemeContext |
| OnboardingProfileOptionalScreen | AuthContext, ThemeContext, api, imageUpload |
| SocialFeedScreen | ui/AccountSlideMenu, ui/GlobalSearchBar (useGlobalSearch, GlobalSearchInput, GlobalSearchOverlay), news/NewsFeed, news/NewsSection, news/QuickCheckInModal, AuthContext, ThemeContext, api, feedApi, newsApi, coverUrl, feedAddedEvent, navigation/useBottomFooterLayout |
| FeedDetailScreen | AuthContext, ThemeContext, api, feedApi, coverUrl, feedAddedEvent |
| ShelvesScreen | ui/CategoryIcon, ui/AccountSlideMenu, ui/GlobalSearchBar (useGlobalSearch, GlobalSearchInput, GlobalSearchOverlay), AuthContext, ThemeContext, api, navigation/useBottomFooterLayout |
| ShelfDetailScreen | AuthContext, ThemeContext, api, coverUrl, ocr, ui/CachedImage, ui/StarRating, ui/CategoryIcon, VisionProcessingModal, navigation/useBottomFooterLayout |
| ShelfCreateScreen | AuthContext, ThemeContext, api, imageUpload, navigation/useBottomFooterLayout |
| ShelfEditScreen | AuthContext, ThemeContext, api, imageUpload, navigation/useBottomFooterLayout |
| ShelfSelectScreen | ui/CategoryIcon, AuthContext, ThemeContext, api, navigation/useBottomFooterLayout |
| ItemSearchScreen | AuthContext, ThemeContext, api, coverUrl, useCollectableSearchEngine, navigation/useBottomFooterLayout |
| CollectableDetailScreen | AuthContext, ThemeContext, ui/CachedImage, ui/StarRating, ui/CategoryIcon, api, coverUrl, imageUpload, assets/tmdb-logo.svg, expo-image-manipulator, expo-file-system/legacy, navigation/useBottomFooterLayout |
| ItemDetailsScreen | AuthContext, ThemeContext, api, navigation/useBottomFooterLayout |
| MarketValueSourcesScreen | AuthContext, ThemeContext, api, navigation/useBottomFooterLayout |
| CheckInScreen | AuthContext, ThemeContext, api, useSearch |
| ManualEditScreen | AuthContext, ThemeContext, api |
| AccountScreen | AuthContext, ThemeContext, PushContext, api, useAsync (manages is_private + show_personal_photos toggles) |
| ProfileScreen | AuthContext, ThemeContext, api, imageUpload, feedAddedEvent |
| ProfileEditScreen | AuthContext, ThemeContext, api, imageUpload |
| FriendSearchScreen | AuthContext, ThemeContext, api, coverUrl, useCollectableSearchEngine |
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
utils/onboarding.js  (no internal imports)
```

### Theme

```
theme/index.js       (no internal imports â€” dark theme tokens)
theme/theme_light.js (no internal imports â€” light theme tokens)
```

---

## Website Dependency Tree

### Entry + Route Segments

```
website/src/app/layout.tsx
  -> website/src/app/globals.css
  -> website/src/content.json

website/src/app/page.tsx
  -> website/src/content.json
  -> website/src/app/WaitlistForm.tsx
  -> website/src/app/page.module.css
  -> website/src/app/HomeSlideshow.tsx

website/src/app/WaitlistForm.tsx
  -> website/src/app/waitlist-form.module.css
  -> (env) NEXT_PUBLIC_API_BASE

website/src/app/about/page.tsx
  (static content page)

website/src/app/how-it-works/page.tsx
  (static content page)

website/src/app/privacy/page.tsx
  (static content page)

website/src/app/books/page.tsx
  -> website/src/app/components/CategoryPage.tsx

website/src/app/collectibles/page.tsx
  -> website/src/app/components/CategoryPage.tsx

website/src/app/movies/page.tsx
  -> website/src/app/components/CategoryPage.tsx

website/src/app/video-games/page.tsx
  -> website/src/app/components/CategoryPage.tsx

website/src/app/vinyl/page.tsx
  -> website/src/app/components/CategoryPage.tsx

website/src/app/reset-password/page.tsx
  -> website/src/app/reset-password/reset-password-client.tsx

website/src/app/reset-password/reset-password-client.tsx
  -> website/src/app/reset-password/reset-password.module.css
  -> next/link
  -> (env) NEXT_PUBLIC_API_BASE
  -> (env) NEXT_PUBLIC_RESET_DEEP_LINK_BASE
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
  -> src/App.jsx
  -> src/context/AuthContext.jsx (AuthProvider)
  -> src/index.css
```

### App.jsx (Router)

```
src/App.jsx
  -> src/context/AuthContext.jsx (useAuth)
  -> src/components/Layout.jsx
  -> src/pages/Login.jsx
  -> src/pages/Dashboard.jsx
  -> src/pages/Users.jsx
  -> src/pages/Content.jsx
  -> src/pages/ActivityFeed.jsx
  -> src/pages/SocialFeed.jsx
  -> src/pages/Jobs.jsx
  -> src/pages/AuditLog.jsx
  -> src/pages/Settings.jsx
```

### Context

```
src/context/AuthContext.jsx
  -> src/api/client.js (login, logout, getMe)
```

### API Client

```
src/api/client.js
  (no internal imports â€” leaf node, uses axios)
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
  -> src/context/AuthContext.jsx (useAuth)

src/pages/Dashboard.jsx
  -> src/api/client.js (getStats, getSystemInfo, getDetailedStats, getRecentFeed)
  -> src/components/StatsCard.jsx
  -> src/components/UserAvatar.jsx
  -> src/utils/errorUtils.js

src/pages/Users.jsx
  -> src/api/client.js (getUsers)
  -> src/components/UserTable.jsx
  -> src/components/UserDetailModal.jsx
  -> src/components/Pagination.jsx

src/pages/Content.jsx
  -> src/api/client.js (getShelves)
  -> src/components/UserAvatar.jsx
  -> src/components/Pagination.jsx
  -> src/components/ShelfDetailModal.jsx

src/pages/ActivityFeed.jsx
  -> src/api/client.js (getRecentFeed)
  -> src/components/UserAvatar.jsx
  -> src/components/Pagination.jsx

src/pages/SocialFeed.jsx
  -> src/api/client.js (getAdminSocialFeed, getAdminEventComments, deleteEvent)
  -> src/components/UserAvatar.jsx
  -> src/components/Pagination.jsx
  -> src/utils/errorUtils.js

src/pages/Jobs.jsx
  -> src/api/client.js (getJobs)
  -> src/components/Pagination.jsx
  -> src/components/JobDetailModal.jsx

src/pages/AuditLog.jsx
  -> src/api/client.js (getAuditLogs)
  -> src/components/Pagination.jsx

src/pages/Settings.jsx
  -> src/context/AuthContext.jsx (useAuth)
  -> src/api/client.js (getSettings, updateSetting)
  -> src/utils/errorUtils.js
```

### Components

```
src/components/Layout.jsx
  -> src/components/Sidebar.jsx

src/components/Sidebar.jsx
  -> src/context/AuthContext.jsx (useAuth)

src/components/UserTable.jsx
  -> src/components/UserAvatar.jsx
  -> src/components/UserBadge.jsx (SuspendedBadge, AdminBadge, PremiumBadge)

src/components/UserDetailModal.jsx
  -> src/api/client.js (getUser, suspendUser, unsuspendUser, toggleAdmin, togglePremium, getUserVisionQuota, resetUserVisionQuota, setUserVisionQuota)
  -> src/components/UserAvatar.jsx
  -> src/components/UserBadge.jsx (default: UserBadge)
  -> src/utils/errorUtils.js

src/components/JobDetailModal.jsx
  -> src/api/client.js (getJob)
  -> src/utils/errorUtils.js

src/components/ShelfDetailModal.jsx
  -> src/api/client.js (getShelf, getShelfItems)
  -> src/components/UserAvatar.jsx
  -> src/components/Pagination.jsx
  -> src/utils/errorUtils.js

src/components/StatsCard.jsx     (uses react-router-dom useNavigate)
src/components/UserBadge.jsx     (leaf â€” no internal imports)
src/components/UserAvatar.jsx    (leaf â€” no internal imports)
src/components/Pagination.jsx    (leaf â€” no internal imports)
```

### Utils

```
src/utils/errorUtils.js          (leaf â€” no internal imports)
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
  â”œâ”€< shelves (user_id FK)
  â”‚     â”œâ”€â”€ game_defaults (JSONB, nullable; games shelf platform/format defaults)
  â”‚     â”œâ”€â”€ photo_storage_* + photo_updated_at (nullable shelf-level custom photo metadata)
  â”‚     â”œâ”€< user_collections (shelf_id FK)
  â”‚     â”‚     â”œâ”€â”€ collectables (collectable_id FK) â”€â”€> collectables table
  â”‚     â”‚     â””â”€â”€ user_manuals (manual_id FK) â”€â”€> user_manuals table
  â”‚     â”‚         (CHECK: exactly one of collectable_id or manual_id)
  â”‚     â”‚         (platform_missing BOOLEAN NOT NULL DEFAULT FALSE)
  â”‚     â””â”€< needs_review (shelf_id FK)
  â”œâ”€< user_manuals (user_id FK)
  â”‚     â””â”€â”€ cover_media_path (S3/local)
  â”œâ”€< user_ratings (user_id FK)
  â”‚     â”œâ”€â”€ collectable_id FK â”€â”€> collectables
  â”‚     â””â”€â”€ manual_id FK â”€â”€> user_manuals
  â”œâ”€< friendships (requester_id / addressee_id FK)
  â”œâ”€< event_aggregates (user_id FK)
  â”‚     â”œâ”€< event_logs (aggregate_id FK)
  â”‚     â”œâ”€< event_likes (aggregate_id FK, user_id FK)
  â”‚     â””â”€< event_comments (aggregate_id FK, user_id FK)
  â”œâ”€< notifications (user_id FK, actor_id FK)
  â”œâ”€< push_device_tokens (user_id FK)
  â”œâ”€â”€ notification_preferences (user_id PK)
  â”œâ”€â”€ user_vision_quota (user_id PK; scans_used + tokens_used + output_tokens_used)
  Ã¢â€Å“Ã¢â€â‚¬< workflow_queue_jobs (user_id FK, shelf_id FK nullable)
  â”œâ”€< password_reset_tokens (user_id FK)
  â”œâ”€< wishlists (user_id FK)
  â”‚     â””â”€< wishlist_items (wishlist_id FK)
  â”œâ”€< user_favorites (user_id FK)
  â”‚     â”œâ”€â”€ collectable_id FK â”€â”€> collectables
  â”‚     â””â”€â”€ manual_id FK â”€â”€> user_manuals
  â”œâ”€< user_lists (user_id FK)
  â”‚     â””â”€< user_list_items (list_id FK)
  â”œâ”€< user_news_seen (user_id FK)
  â”œâ”€< user_news_dismissed (user_id FK)
  â”œâ”€â”€ profile_media (user_id FK)
  â”œâ”€â”€ premium_locked_by_admin (BOOLEAN, default FALSE)
  â”œâ”€â”€ unlimited_vision_tokens (BOOLEAN, default FALSE)
  â””â”€< admin_action_logs (admin_id FK)

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

vision_token_log (SERIAL PK)
  -> user_id (FK -> users.id)
  -> job_id (text)
  -> call_label (text)
  -> prompt_tokens / candidates_tokens / total_tokens
  -> created_at

workflow_queue_jobs (job_id TEXT PK)
  -> workflow_type (text, current primary type: vision)
  -> user_id (FK -> users.id)
  -> shelf_id (FK -> shelves.id, nullable)
  -> status in {queued, processing, completed, failed, aborted}
  -> priority, attempt_count, max_attempts
  -> dedupe_key, abort_requested, notify_on_complete
  -> payload/result/error JSONB
  -> claimed_at, started_at, finished_at, created_at, updated_at


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

user_collection_platforms (SERIAL PK)
  -> collection_item_id (FK -> user_collections.id ON DELETE CASCADE)
  -> platform_name (TEXT NOT NULL)
  -> created_at
  UNIQUE(collection_item_id, lower(platform_name))
  INDEX(lower(platform_name))

system_settings (key VARCHAR PK)
  â”œâ”€â”€ value (JSONB, not null)
  â”œâ”€â”€ description (TEXT, nullable)
  â””â”€â”€ updated_by (FK -> users.id, nullable)

collectables (SERIAL PK)
  -> max_players (INTEGER, nullable)
  -> platform_data (JSONB, default `[]`)
  -> igdb_payload (JSONB, default `NULL`)
  â”œâ”€â”€ fingerprint (SHA1 hash, unique)
  â”œâ”€â”€ lightweight_fingerprint
  â”œâ”€â”€ kind âˆˆ {book, movie, game, album}
  â”œâ”€< editions (collectable_id FK)
  â”œâ”€< media (collectable_id FK)
  â””â”€< news_items (collectable_id FK, nullable)

news_items (SERIAL PK)
  â”œâ”€â”€ category, item_type, source
  â”œâ”€â”€ expires_at (cache TTL)
  â”œâ”€< user_news_seen (news_item_id FK)
  â””â”€< user_news_dismissed (news_item_id FK)
```

### Key Constraints

- `user_collections`: CHECK ensures exactly one of `collectable_id` or `manual_id` is set
- `user_collections.platform_missing`: BOOLEAN NOT NULL DEFAULT FALSE; set when games default platform mismatches available item evidence
- `user_collections`: UNIQUE partial index on `(user_id, shelf_id, manual_id)` when `manual_id IS NOT NULL` (prevents duplicate manual links on one shelf)
- `user_collection_platforms`: UNIQUE index on `(collection_item_id, lower(platform_name))` (prevents duplicate owned-platform chips per shelf item)
- `user_manuals`: UNIQUE partial index on `(user_id, shelf_id, manual_fingerprint)` when `manual_fingerprint IS NOT NULL` (prevents duplicate manual rows per shelf fingerprint)
- `friendships`: CHECK prevents self-friendship; status âˆˆ {pending, accepted, blocked}
- `shelves.type` âˆˆ {books, movies, games, vinyl, tv, other}
- `shelves.visibility` âˆˆ {private, friends, public}
- `shelves.game_defaults`: nullable JSONB contract for games shelf defaults (`platformType/customPlatformText/format`)
- `shelves_photo_storage_check`: shelf photo metadata must be fully null OR a valid complete storage record (`photo_storage_provider` in `{s3,local}` + key/type/size/dimensions/updated_at)
- `users.email`: UNIQUE constraint
- `collectables.title`: GIN pg_trgm index for fuzzy search
- `collectables.cast_members`: partial GIN index (`idx_collectables_cast_members_gin`) for exact cast-name containment lookups
- `workflow_queue_jobs.status`: CHECK constraint (`queued|processing|completed|failed|aborted`)
- `workflow_queue_jobs`: active dedupe UNIQUE partial index `uq_workflow_queue_dedupe_active (workflow_type, dedupe_key)` for queued/processing rows

### Row Level Security (RLS)

- **Tier 1** (user isolation): shelves, user_collections, user_manuals, user_ratings, needs_review, item_replacement_traces, push_device_tokens, notification_preferences, user_vision_quota, wishlists, wishlist_items, user_favorites, user_lists, user_list_items
- **Tier 2** (visibility): shelves (public/friends), profiles
- **Tier 3** (complex joins): friendships, feed
- **Tier 4** (cascading): dependent tables
- Admin bypass via `is_current_user_admin()` DB function
- Context set via `SET LOCAL "app.current_user_id"` in `queryWithContext()` / `transactionWithContext()`

### Migration History (66 files, 2026-01-10 -> 2026-04-09)

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
| `20260121_normalize_shelf_types_plural` | Data migration (shelf types -> plural) |
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
| `20260325201500_add_reviewed_event_link_to_user_collections` | + `user_collections.reviewed_event_*` columns for review/feed event linking |
| `20260326000000_create_user_market_value_estimates` | + `user_market_value_estimates` table |
| `20260326010000_show_personal_photos_default_true` | `users.show_personal_photos` default -> TRUE (flips existing users), `user_collections.owner_photo_visible` default -> TRUE |
| `20260328000000_add_mention_notification_type` | Expand `notifications` type CHECK constraint to include `'mention'`, + `notification_preferences.push_mentions` (BOOLEAN DEFAULT TRUE) |
| `20260329010000_add_collectables_cast_members` | + `collectables.cast_members` (JSONB) and partial GIN index `idx_collectables_cast_members_gin` for cast containment lookups |
| `20260330010000_create_workflow_queue_jobs` | + `workflow_queue_jobs` (durable workflow queue table, claim/active-dedupe indexes, status/attempt constraints, updated_at trigger) |
| `20260330010010_add_workflow_job_notifications` | expand `notifications` type/entity CHECK constraints for workflow jobs (`workflow_complete`, `workflow_failed`, `workflow_job`) and + `notification_preferences.push_workflow_jobs` |
| `20260330180000_add_users_terms_acceptance_fields` | + `users.terms_accepted`, `users.terms_accepted_version`, `users.terms_accepted_at` |
| `20260331100000_add_collectables_platform_data` | + `collectables.platform_data` (JSONB NOT NULL DEFAULT `[]`) |
| `20260331101000_create_user_collection_platforms` | + `user_collection_platforms` (per-shelf-item owned platforms with case-insensitive uniqueness and lookup indexes) |
| `20260331120000_add_collectables_igdb_payload` | + `collectables.igdb_payload` (JSONB) |
| `20260331130000_add_collectables_max_players` | + `collectables.max_players` (INTEGER) |
| `20260331190000_add_shelf_game_defaults_and_platform_missing` | + `shelves.game_defaults` (JSONB, nullable) and + `user_collections.platform_missing` (BOOLEAN NOT NULL DEFAULT FALSE) |
| `20260401110000_add_shelf_photo_fields` | + `shelves.photo_storage_provider/photo_storage_key/photo_content_type/photo_size_bytes/photo_width/photo_height/photo_updated_at` + `shelves_photo_storage_check` |
| `20260409120000_add_token_quota_fields` | + `user_vision_quota.tokens_used/output_tokens_used`, + `users.unlimited_vision_tokens` |
| `20260409120001_create_vision_token_log` | + `vision_token_log` |
| `20260409130000_add_user_collection_item_details` | + `user_collections.series/edition/special_markings/age_statement/label_color/regional_item/barcode/item_specific_text` |
---

## External Service Integrations

| Service | Package | API Files | Env Vars |
|---|---|---|---|
| **PostgreSQL 16** | `pg` + `knex` | `database/pg.js`, `knexfile.js` | `DATABASE_URL` or `POSTGRES_*` |
| **Google Gemini AI** | `@google/generative-ai` | `services/googleGemini.js` | `GEMINI_API_KEY` |
| **Google Cloud Vision** | `@google-cloud/vision` | `services/googleCloudVision.js` (disabled) | `GOOGLE_APPLICATION_CREDENTIALS` |
| **OpenAI** | `openai` | (not currently imported) | `OPENAI_API_KEY` |
| **AWS S3** | `@aws-sdk/client-s3` | `services/s3.js` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `S3_PUBLIC_URL`, `AWS_REGION` |
| **Resend** | `resend` | `services/emailService.js`, `routes/waitlist.js`, `routes/account.js` | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_AUDIENCE_ID`, `SUPPORT_EMAIL` |
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
â”œâ”€â”€ theme/
â”‚   â””â”€â”€ tokens.js    (ES module: colors, spacing, radii, typography, shadow)
â””â”€â”€ styles/
    â””â”€â”€ app.css
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

---
