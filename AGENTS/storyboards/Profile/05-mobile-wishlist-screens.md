# Task 05: Mobile Wishlist Screens

## Objective
Create screens for managing wishlists and wishlist items.

## Files to Create

### 1. [NEW] `mobile/src/screens/WishlistsScreen.js`
Display:
- List of user's wishlists
- Each card shows: name, item count, visibility badge
- Tap card → WishlistScreen
- FAB or header button → WishlistCreateScreen

### 2. [NEW] `mobile/src/screens/WishlistScreen.js`
Display:
- Wishlist name and description
- List of items (collectable or manual text)
- Each item shows: title, creator, priority indicator
- Swipe to delete item
- Add item button → ItemSearchScreen or manual input modal

Props: `route.params.wishlistId`

### 3. [NEW] `mobile/src/screens/WishlistCreateScreen.js`
Form:
- Name (required)
- Description (optional)
- Visibility picker (private/friends/public)
- Save button → POST /wishlists

### 4. [NEW] `mobile/src/components/WishlistItemCard.js`
Reusable card:
- Cover image (if collectable)
- Title and creator
- Priority stars/indicator
- Notes preview
- Delete action

## Integration Points
- Reuse ItemSearchScreen for adding collectables
- Add "Add to Wishlist" option in CollectableDetailScreen

## Verification
- [ ] Can create wishlist
- [ ] Can view wishlist items
- [ ] Can add items via search
- [ ] Can add manual text items
- [ ] Can delete items
