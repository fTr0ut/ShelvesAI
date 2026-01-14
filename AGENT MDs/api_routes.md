# API Route Mapping

This document maps the mobile application screens to the backend API endpoints they require. All endpoints are relative to the configured `API_BASE` (e.g., `http://localhost:5001`).

## Authentication & Onboarding
**Screens**: LoginScreen, UsernameSetupScreen

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Authenticate user | `{ username, password }` |
| `POST` | `/api/auth/register` | Create new account | `{ username, password, email }` |
| `GET` | `/api/auth/me` | Validate session / Get basic info | Headers: `Authorization: Bearer <token>` |
| `POST` | `/api/auth/username` | Set username if missing | `{ username }` |
| `POST` | `/api/onboarding/complete` | Mark onboarding complete (requires email, first name, city/state) | - |
| `GET` | `/api/config/onboarding` | Fetch onboarding screen copy | - |

## 1. Home Tab (Feed)
**Screen**: SocialFeedScreen

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/feed` | Fetch activity feed (friends' updates) | `?limit=20&skip=0` |
| `POST` | `/api/feed/:activityId/like` | Like a feed item | - |
| `POST` | `/api/feed/:activityId/comment` | Comment on activity | `{ text }` |

## 2. Shelves Tab (Library)
**Screen**: ShelvesScreen

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/shelves` | List user's shelves | - |

**Screen**: ShelfCreateScreen (Add Button)

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/shelves` | Create a new shelf | `{ name, type, visibility, description }` |

## 3. Shelf Details Workflow
**Screen**: ShelfDetailScreen

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/shelves/:shelfId` | Get shelf metadata | - |
| `GET` | `/api/shelves/:shelfId/items` | Get items in shelf | `?limit=50&skip=0` |
| `PUT` | `/api/shelves/:shelfId` | Update shelf (rename, etc.) | `{ name, description, visibility }` |
| `DELETE` | `/api/shelves/:shelfId/items/:itemId` | Remove item from shelf | - |

**Screen**: ShelfEditScreen

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| `PUT` | `/api/shelves/:shelfId` | Save shelf settings | `{ name, description, visibility }` |
| `DELETE` | `/api/shelves/:shelfId` | Delete entire shelf | - |

## 4. Item Management Workflow
**Screen**: ShelfDetailScreen (Add Items Mode)

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/shelves/:shelfId/items` | Add existing catalog item | `{ collectableId, notes, rating }` |
| `POST` | `/api/shelves/:shelfId/manual` | Add manual entry (no catalog match) | `{ name, type, description }` |
| `GET` | `/api/shelves/:shelfId/search` | Search catalog to add to shelf | `?q=query` |
| `POST` | `/api/shelves/:shelfId/vision` | AI Vision (Camera/Image) | `{ imageBase64 }` |
| `POST` | `/api/shelves/:shelfId/catalog-lookup` | Vision fallback / barcode lookup | `{ query, type }` |

**Screen**: CollectableDetailScreen / ManualEditScreen

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/collectables/:id` | Get full catalog item details | - |
| `PUT` | `/api/shelves/:shelfId/manual/:itemId` | Edit manual item details | `{ name, author, etc. }` |

## 5. Account & Social
**Screen**: AccountScreen

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/account` | Get full profile (stats, friends) | - |
| `PUT` | `/api/account` | Update profile | `{ name, picture, isPrivate }` |

**Screen**: FriendSearchScreen

| Method | Endpoint | Description | Payload / Params |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/friends/search` | Find users | `?q=username` |
| `POST` | `/api/friends/request` | Send friend request | `{ userId }` |
| `POST` | `/api/friends/accept` | Accept friend request | `{ requestId }` |

## Notes
- **Authentication**: All endpoints (except login/register) require `Authorization: Bearer <token>` header.
- **Images**: Image upload for profile or items is handled via base64 or separate media endpoints (implementation detail).
- **Vision**: The `/vision` endpoint is heavy; client should resize images before sending.
