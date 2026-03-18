# API Route Map

Last updated: 2026-02-08 18:13:21 UTC
Source of truth: `api/server.js` and `api/routes/*.js`

All routes below are relative to API base (for example, `http://localhost:5001`).

## Base Notes

- Canonical auth prefix is `/api/auth/*`.
- Legacy aliases also exist for auth endpoints at `/api/*` because `authRoutes` is mounted on both `/api` and `/api/auth`.
- Most routes require `Authorization: Bearer <token>` via `auth` middleware.

## Authentication

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | No | Rate limited (10/15 min per IP). Legacy alias: `/api/login`. |
| POST | `/api/auth/register` | No | Rate limited (5/hour per IP). Legacy alias: `/api/register`. |
| GET | `/api/auth/me` | Yes | Legacy alias: `/api/me`. |
| POST | `/api/auth/username` | Yes | Legacy alias: `/api/username`. |
| POST | `/api/auth/forgot-password` | No | Rate limited (5/15 min per IP). |
| POST | `/api/auth/reset-password` | No | Rate limited (5/15 min per IP). |
| GET | `/api/auth/validate-reset-token` | No | Rate limited (5/15 min per IP). |

## Account and Profile

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/account` | Yes | Returns `{ user, visionQuota }`. |
| PUT | `/api/account` | Yes | Allows `is_premium` updates from user account settings. |
| GET | `/api/profile` | Yes | Current user profile. |
| PUT | `/api/profile` | Yes | Update current user profile fields. |
| POST | `/api/profile/photo` | Yes | Multipart upload (`photo`), 5 MB image cap. |
| GET | `/api/profile/:username` | Optional | Public profile with optional viewer context. |
| GET | `/api/profile/:username/shelves` | Optional | Shelf list filtered by visibility rules. |
| POST | `/api/onboarding/complete` | Yes | Requires email, firstName, city, state already set. |
| GET | `/api/config/onboarding` | No | Returns onboarding screen config JSON. |

## Shelves and Items

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/shelves` | Yes | List my shelves. |
| POST | `/api/shelves` | Yes | Requires `name`, `type`. |
| GET | `/api/shelves/:shelfId` | Yes | Shelf detail. |
| PUT | `/api/shelves/:shelfId` | Yes | Update shelf metadata. |
| DELETE | `/api/shelves/:shelfId` | Yes | Delete shelf. |
| GET | `/api/shelves/:shelfId/items` | Yes | List shelf items. |
| POST | `/api/shelves/:shelfId/items` | Yes | Requires `collectableId`. |
| POST | `/api/shelves/:shelfId/items/from-api` | Yes | Add from provider payload. |
| DELETE | `/api/shelves/:shelfId/items/:itemId` | Yes | Remove shelf item. |
| PUT | `/api/shelves/:shelfId/items/:itemId/rating` | Yes | Set/clear rating (0-5 in 0.5 steps). |
| GET | `/api/shelves/:shelfId/search` | Yes | Catalog search scoped for add flow. |
| POST | `/api/shelves/:shelfId/manual/search` | Yes | Suggest matches before manual save. |
| POST | `/api/shelves/:shelfId/manual` | Yes | Requires `name`. |
| PUT | `/api/shelves/:shelfId/manual/:itemId` | Yes | Update manual item. |
| POST | `/api/shelves/:shelfId/manual/:itemId/cover` | Yes | Multipart upload (`cover`), 5 MB image cap. |
| POST | `/api/shelves/:shelfId/vision` | Yes | Async vision job endpoint. |
| GET | `/api/shelves/:shelfId/vision/:jobId/status` | Yes | Poll job progress/result. |
| DELETE | `/api/shelves/:shelfId/vision/:jobId` | Yes | Abort active job. |
| POST | `/api/shelves/:shelfId/catalog-lookup` | Yes | MLKit/manual parsed items enrichment. |
| GET | `/api/shelves/:shelfId/review` | Yes | Needs-review queue for shelf. |
| POST | `/api/shelves/:shelfId/review/:id/complete` | Yes | Resolve one review item. |
| DELETE | `/api/shelves/:shelfId/review/:id` | Yes | Dismiss one review item. |

## Catalog, Manuals, and Review Queue

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/collectables` | Yes | Global catalog search/list. |
| GET | `/api/collectables/:collectableId` | Yes | Collectable detail. |
| POST | `/api/collectables` | Yes | Write path guarded by `ALLOW_CATALOG_WRITE=true`. |
| POST | `/api/collectables/from-news` | Yes | Resolve/create collectable from discovery payload. |
| PUT | `/api/collectables/:collectableId` | Yes | Update core collectable metadata. |
| GET | `/api/manuals/:manualId` | Yes | Manual item detail. |
| GET | `/api/unmatched` | Yes | All pending review items for current user. |
| GET | `/api/unmatched/count` | Yes | Pending count badge endpoint. |
| GET | `/api/unmatched/:id` | Yes | Single review item. |
| PUT | `/api/unmatched/:id` | Yes | Complete review item with matching flow. |
| DELETE | `/api/unmatched/:id` | Yes | Dismiss one review item. |
| DELETE | `/api/unmatched/all` | Yes | Dismiss all pending review items. |

## Feed, Social, and Check-In

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/feed` | Yes | Main feed list (`scope`, `limit`, `offset`, filters). |
| GET | `/api/feed/:shelfId` | Yes | Supports aggregate IDs and numeric shelf IDs. |
| POST | `/api/feed/:eventId/like` | Yes | Toggle like. |
| POST | `/api/feed/:eventId/comments` | Yes | Add comment (`content`). |
| GET | `/api/feed/:eventId/comments` | Yes | List comments. |
| DELETE | `/api/feed/:eventId/comments/:commentId` | Yes | Delete own comment. |
| GET | `/api/checkin/search` | Yes | Search collectables + my manual items. |
| POST | `/api/checkin` | Yes | Create check-in (`collectableId` or `manualId`, status, visibility, note). |

## Friends, Notifications, Push

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/friends` | Yes | List friendships. |
| GET | `/api/friends/search` | Yes | Search users. |
| POST | `/api/friends/request` | Yes | Requires UUID `targetUserId`. |
| POST | `/api/friends/respond` | Yes | Requires `friendshipId`, `action`. |
| DELETE | `/api/friends/:id` | Yes | Remove friendship. |
| GET | `/api/notifications` | Yes | List notifications. |
| GET | `/api/notifications/unread-count` | Yes | Unread count. |
| POST | `/api/notifications/read` | Yes | Requires `notificationIds`. |
| POST | `/api/push/register` | Yes | Register Expo push token/device. |
| POST | `/api/push/unregister` | Yes | Unregister push token/device. |
| GET | `/api/push/preferences` | Yes | Get push prefs. |
| PATCH | `/api/push/preferences` | Yes | Update push prefs. |

## Ratings, Discover, Lists, Wishlists, Favorites

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/ratings/:itemId` | Yes | Get my rating (`?type=manual` for manual items). |
| PUT | `/api/ratings/:itemId` | Yes | Set my rating (`?type=manual` supported). |
| GET | `/api/ratings/:collectableId/aggregate` | Yes | Collectable aggregate rating. |
| GET | `/api/ratings/:itemId/user/:userId` | Yes | Another user's rating for item. |
| GET | `/api/discover` | Optional | Personalized feed with optional auth. |
| GET | `/api/discover/stats` | Optional | Discover cache stats. |
| POST | `/api/discover/dismiss` | Yes | Negative vote / dismissal. |
| GET | `/api/lists` | Yes | List custom lists. |
| POST | `/api/lists` | Yes | Create list. |
| GET | `/api/lists/:id` | Yes | Get list detail. |
| PUT | `/api/lists/:id` | Yes | Update list metadata. |
| DELETE | `/api/lists/:id` | Yes | Delete list. |
| POST | `/api/lists/:id/items` | Yes | Add item to list. |
| DELETE | `/api/lists/:id/items/:itemId` | Yes | Remove item from list. |
| PUT | `/api/lists/:id/reorder` | Yes | Reorder list items. |
| GET | `/api/wishlists` | Yes | List my wishlists. |
| POST | `/api/wishlists` | Yes | Create wishlist. |
| GET | `/api/wishlists/user/:userId` | Yes | View user wishlists. |
| GET | `/api/wishlists/user/:userId/check` | Yes | Check if user has wishlists. |
| GET | `/api/wishlists/:id` | Yes | Wishlist detail. |
| PUT | `/api/wishlists/:id` | Yes | Update wishlist. |
| DELETE | `/api/wishlists/:id` | Yes | Delete wishlist. |
| GET | `/api/wishlists/:id/items` | Yes | List wishlist items. |
| POST | `/api/wishlists/:id/items` | Yes | Add wishlist item. |
| DELETE | `/api/wishlists/:id/items/:itemId` | Yes | Remove wishlist item. |
| GET | `/api/favorites` | Yes | List my favorites. |
| POST | `/api/favorites` | Yes | Add favorite. |
| DELETE | `/api/favorites/:collectableId` | Yes | Remove favorite. |
| GET | `/api/favorites/:collectableId/check` | Yes | Check favorite status. |
| POST | `/api/favorites/check-batch` | Yes | Batch favorite check. |
| GET | `/api/favorites/user/:userId` | Yes | List user favorites. |
| GET | `/api/favorites/user/:userId/check` | Yes | Check if user has favorites. |

## Admin

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/admin/login` | No | Admin login endpoint, separate limiter (5/15 min). |
| GET | `/api/admin/stats` | Admin | Dashboard counts. |
| GET | `/api/admin/users` | Admin | User list/filter/search. |
| GET | `/api/admin/users/:userId` | Admin | User detail + counts. |
| POST | `/api/admin/users/:userId/suspend` | Admin | Suspend user. |
| POST | `/api/admin/users/:userId/unsuspend` | Admin | Unsuspend user. |
| POST | `/api/admin/users/:userId/toggle-admin` | Admin | Grant/revoke admin. |
| GET | `/api/admin/feed/recent` | Admin | Recent aggregate activity. |
| GET | `/api/admin/system` | Admin | Runtime health info. |
