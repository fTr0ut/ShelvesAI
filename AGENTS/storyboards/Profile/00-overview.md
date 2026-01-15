# Profile Pages Feature - Overview

## Goal
Add public profile pages to ShelvesAI where users can showcase their bio, profile photo, public/friends-visible shelves, and wishlists.

## Tasks (In Order)

| # | File | Description | Status |
|---|------|-------------|--------|
| 1 | [01-database-migration.md](./01-database-migration.md) | Add bio field, profile_media table, wishlists tables | ✅ |
| 2 | [02-backend-profile-api.md](./02-backend-profile-api.md) | Profile controller, routes, photo upload | ✅ |
| 3 | [03-backend-wishlists-api.md](./03-backend-wishlists-api.md) | Wishlist CRUD endpoints | ✅ |
| 4 | [04-mobile-profile-screens.md](./04-mobile-profile-screens.md) | ProfileScreen, ProfileEditScreen | ✅ |
| 5 | [05-mobile-wishlist-screens.md](./05-mobile-wishlist-screens.md) | WishlistScreen, WishlistCreateScreen | ✅ |
| 6 | [06-navigation-integration.md](./06-navigation-integration.md) | Wire up navigation and tappable links | ✅ |
| 7 | [07-verification.md](./07-verification.md) | Testing and validation | ✅ |

## Key Files

### Backend
- `api/database/migrations/02-profile-wishlists.sql`
- `api/database/queries/wishlists.js`
- `api/database/queries/profileMedia.js`
- `api/controllers/profileController.js`
- `api/controllers/wishlistController.js`
- `api/routes/profile.js`
- `api/routes/wishlists.js`

### Mobile
- `mobile/src/screens/ProfileScreen.js`
- `mobile/src/screens/ProfileEditScreen.js`
- `mobile/src/screens/WishlistScreen.js`
- `mobile/src/screens/WishlistCreateScreen.js`
