# User Rating System

Implement half-point star ratings (0-5) for items on user shelves.

## Overview
- Rating scale: 0 to 5 stars in 0.5 increments
- Stored in existing `user_collections.rating` column (DECIMAL(2,1))
- Rating can be set from ShelfDetailScreen
- Rating changes trigger feed events

---

## Phase 1: Backend

### Task 1.1: Add updateItemRating query
- [x] Add `updateItemRating(itemId, userId, shelfId, rating)` to `shelves.js`
- [x] Validate rating is between 0-5 and is half-point (0, 0.5, 1, 1.5... 5)

### Task 1.2: Add rating controller endpoint
- [x] Add `rateShelfItem` function to `shelvesController.js`
- [x] Validate input rating
- [x] Update rating via query
- [x] Log `item.rated` event to feed with collectable details

### Task 1.3: Add route
- [x] Add `PUT /:shelfId/items/:itemId/rating` to `routes/shelves.js`

---

## Phase 2: Mobile UI

### Task 2.1: Create StarRating component
- [x] Create reusable `StarRating.js` component
- [x] Support half-star display (filled, half, empty)
- [x] Interactive mode for setting rating
- [x] Display-only mode for read-only views

### Task 2.2: Integrate into ShelfDetailScreen
- [x] Add StarRating to item cards (for owner only)
- [x] Fetch current rating from item data
- [x] Call API on rating change
- [x] Optimistic UI update

---

## Verification
- [ ] Rate an item, refresh, confirm rating persists
- [ ] Verify rating appears in feed
- [ ] Test half-star ratings (4.5, 3.5, etc.)
- [ ] Verify read-only users cannot rate
