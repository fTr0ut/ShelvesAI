# Favorites System

Allow users to mark items they love as favorites.

## Overview
- Favorites are items the user owns (on their shelves) that they particularly love
- Different from Wishlists (items user wants to acquire)
- Favorites accessible via "My Favorites" button on profile (next to Wishlists)
- Favoriting triggers feed events

---

## Phase 1: Database

### Task 1.1: Create user_favorites table
- [x] Add `user_favorites` table to `01-schema.sql`
- [x] Columns: id, user_id, collectable_id, created_at
- [x] Unique constraint on (user_id, collectable_id)
- [x] Indexes for user_id and collectable_id

---

## Phase 2: Backend

### Task 2.1: Create favorites.js queries
- [x] Create `api/database/queries/favorites.js`
- [x] `listForUser(userId)` - Get all favorites with collectable details
- [x] `isFavorite(userId, collectableId)` - Check if favorited
- [x] `addFavorite(userId, collectableId)` - Add to favorites
- [x] `removeFavorite(userId, collectableId)` - Remove from favorites

### Task 2.2: Create favoritesController.js
- [x] Create `api/controllers/favoritesController.js`
- [x] `listFavorites` - GET /favorites
- [x] `addFavorite` - POST /favorites (log feed event)
- [x] `removeFavorite` - DELETE /favorites/:collectableId
- [x] `checkFavorite` - GET /favorites/:collectableId/check

### Task 2.3: Create favorites routes
- [x] Create `api/routes/favorites.js`
- [x] Register routes in main app

---

## Phase 3: Mobile UI

### Task 3.1: Add favorite button to ShelfDetailScreen
- [x] Add heart icon to item cards
- [x] Filled heart = favorited, outline = not favorited
- [x] Toggle on tap (for owner only)
- [x] Optimistic UI update

### Task 3.2: Add "My Favorites" button to ProfileScreen
- [x] Add button next to "My Wishlists" 
- [x] Navigate to FavoritesScreen on tap

### Task 3.3: Create FavoritesScreen
- [x] Create `FavoritesScreen.js`
- [x] List favorites with collectable details
- [x] Allow removal from favorites
- [x] Register in navigation

---

## Verification
- [ ] Favorite an item from ShelfDetailScreen
- [ ] Verify heart icon fills
- [ ] Navigate to ProfileScreen, tap "My Favorites" button
- [ ] Verify item appears in FavoritesScreen
- [ ] Unfavorite, verify removal from list
- [ ] Verify feed shows favorite events
