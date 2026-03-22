# ShelvesAI Dependency Tree

> **Maintenance rule:** Any agent making changes to the codebase MUST update this file to reflect new files, removed files, changed imports, new tables, or new routes. This is a living document.

Last updated: 2026-03-22

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Cross-Component Dependencies](#cross-component-dependencies)
3. [API Dependency Tree](#api-dependency-tree)
4. [Mobile Dependency Tree](#mobile-dependency-tree)
5. [Website Dependency Tree](#website-dependency-tree)
6. [Admin Dashboard Dependency Tree](#admin-dashboard-dependency-tree)
7. [Database Schema Map](#database-schema-map)
8. [External Service Integrations](#external-service-integrations)
9. [Shared Module](#shared-module)

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

### API ↔ Admin Dashboard Contract

| Admin Client Function | API Route | Auth |
|---|---|---|
| `login()` | `POST /api/admin/login` | None (sets cookie) |
| `getMe()` | `GET /api/admin/me` | Cookie |
| `logout()` | `POST /api/admin/logout` | Cookie + CSRF |
| `getStats()` | `GET /api/admin/stats` | Cookie |
| `getUsers(params)` | `GET /api/admin/users` | Cookie |
| `getUser(userId)` | `GET /api/admin/users/:userId` | Cookie |
| `suspendUser(userId, reason)` | `POST /api/admin/users/:userId/suspend` | Cookie + CSRF |
| `unsuspendUser(userId)` | `POST /api/admin/users/:userId/unsuspend` | Cookie + CSRF |
| `toggleAdmin(userId)` | `POST /api/admin/users/:userId/toggle-admin` | Cookie + CSRF |
| `getRecentFeed(params)` | `GET /api/admin/feed/recent` | Cookie (⚠️ dead code — defined but never called) |
| `getSystemInfo()` | `GET /api/admin/system` | Cookie |

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
  -> api/middleware/requestLogger.js
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

api/utils/jobRunner.js
  -> api/context.js
  -> api/logger.js
  -> api/database/queries/jobRuns.js
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
  → controllers/shelvesController.js
  → middleware/auth.js
  → middleware/validate.js
  → utils/imageValidation.js

controllers/shelvesController.js
  → database/pg.js
  → database/queries/shelves.js
  → database/queries/collectables.js
  → database/queries/feed.js
  → database/queries/utils.js
  → database/queries/needsReview.js
  → database/queries/visionQuota.js
  → database/queries/manualMedia.js
  → services/collectables/fingerprint.js
  → services/collectableMatchingService.js
  → services/catalog/BookCatalogService.js
  → services/catalog/MovieCatalogService.js
  → services/catalog/GameCatalogService.js
  → services/visionPipeline.js
  → services/visionPipelineHooks.js
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

controllers/adminController.js
  → database/queries/admin.js
  -> database/queries/jobRuns.js
  → database/queries/systemSettings.js
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
  → config/constants.js
  → config/visionSettings.json

services/visionPipelineHooks.js
  (no internal imports — hook registry)

services/processingStatus.js
  (no internal imports — in-memory Map)

services/googleGemini.js
  → config/visionSettings.json

services/googleCloudVision.js
  (no internal imports — disabled)

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
```

### Database Query Dependencies

```
database/pg.js
  (no internal imports — pg Pool singleton)

database/queries/utils.js
  (no internal imports — pure helpers)

database/queries/auth.js → database/pg.js, database/queries/utils.js
database/queries/shelves.js → database/pg.js, database/queries/utils.js
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
database/queries/profileMedia.js → database/pg.js, services/s3.js
database/queries/passwordReset.js → database/pg.js
database/queries/visionQuota.js → database/pg.js
database/queries/pushDeviceTokens.js → database/pg.js, database/queries/utils.js
database/queries/notificationPreferences.js → database/pg.js, database/queries/utils.js
database/queries/systemSettings.js → database/pg.js, database/queries/utils.js
database/queries/newsSeen.js → database/pg.js
database/queries/newsDismissed.js → database/pg.js
database/queries/admin.js → database/pg.js, database/queries/utils.js
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
config/visionSettings.json       (per-type OCR/confidence thresholds + prompts)
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
  → context/AuthContext.js
  → context/ThemeContext.js
  → context/PushContext.js
  → context/ToastContext.js
  → navigation/BottomTabNavigator.js
  → navigation/linkingConfig.js
  → services/api.js
  → components/Toast.js
  → screens/* (all 33 screens listed below)
```

### Context Providers

```
context/AuthContext.js
  (no internal imports — pure createContext)

context/ThemeContext.js
  → theme/index.js (dark theme)
  → theme/theme_light.js

context/ToastContext.js
  (no internal imports)

context/PushContext.js
  → services/pushNotifications.js
  → context/AuthContext.js
```

### Navigation

```
navigation/BottomTabNavigator.js
  → context/ThemeContext.js
  → screens/SocialFeedScreen.js
  → screens/ShelvesScreen.js

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
```

### Pages

```
src/pages/Login.jsx
  → src/context/AuthContext.jsx (useAuth)

src/pages/Dashboard.jsx
  → src/api/client.js (getStats, getSystemInfo)
  → src/components/StatsCard.jsx
  → src/utils/errorUtils.js

src/pages/Users.jsx
  → src/api/client.js (getUsers)
  → src/components/UserTable.jsx
  → src/components/UserDetailModal.jsx
  → src/components/Pagination.jsx

src/pages/Settings.jsx
  → src/context/AuthContext.jsx (useAuth)
```

### Components

```
src/components/Layout.jsx
  → src/components/Sidebar.jsx

src/components/Sidebar.jsx
  → src/context/AuthContext.jsx (useAuth)

src/components/UserTable.jsx
  → src/components/UserAvatar.jsx
  → src/components/UserBadge.jsx (SuspendedBadge, AdminBadge)

src/components/UserDetailModal.jsx
  → src/api/client.js (getUser, suspendUser, unsuspendUser, toggleAdmin)
  → src/components/UserAvatar.jsx
  → src/components/UserBadge.jsx (default: UserBadge)
  → src/utils/errorUtils.js

src/components/StatsCard.jsx     (leaf — no internal imports)
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
| `api/client.js` | AuthContext, Dashboard, Users (via UserDetailModal) |
| `context/AuthContext.jsx` | main, App, Login, Settings, Sidebar |
| `components/Layout.jsx` | App |
| `components/Sidebar.jsx` | Layout |
| `components/StatsCard.jsx` | Dashboard |
| `components/UserTable.jsx` | Users |
| `components/UserDetailModal.jsx` | Users |
| `components/UserBadge.jsx` | UserTable, UserDetailModal |
| `components/UserAvatar.jsx` | UserTable, UserDetailModal |
| `components/Pagination.jsx` | Users |
| `utils/errorUtils.js` | Dashboard, UserDetailModal |

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
- `friendships`: CHECK prevents self-friendship; status ∈ {pending, accepted, blocked}
- `shelves.type` ∈ {books, movies, games, vinyl, tv, other}
- `shelves.visibility` ∈ {private, friends, public}
- `users.email`: UNIQUE constraint
- `collectables.title`: GIN pg_trgm index for fuzzy search

### Row Level Security (RLS)

- **Tier 1** (user isolation): shelves, user_collections, user_manuals, user_ratings, needs_review, push_device_tokens, notification_preferences, user_vision_quota, wishlists, wishlist_items, user_favorites, user_lists, user_list_items
- **Tier 2** (visibility): shelves (public/friends), profiles
- **Tier 3** (complex joins): friendships, feed
- **Tier 4** (cascading): dependent tables
- Admin bypass via `is_current_user_admin()` DB function
- Context set via `SET LOCAL "app.current_user_id"` in `queryWithContext()` / `transactionWithContext()`

### Migration History (42 files, 2026-01-10 -> 2026-03-22)

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
