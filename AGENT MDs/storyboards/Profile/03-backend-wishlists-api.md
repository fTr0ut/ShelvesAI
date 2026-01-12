# Task 03: Backend Wishlists API

## Objective
Create CRUD endpoints for wishlists and wishlist items.

## Files to Create

### 1. [NEW] `api/database/queries/wishlists.js`
Functions:
- `listForUser(userId)` - get all wishlists for user
- `getById(wishlistId, userId)` - get single wishlist
- `getForViewing(wishlistId, viewerId)` - respects visibility
- `create({ userId, name, description, visibility })`
- `update(wishlistId, userId, updates)`
- `remove(wishlistId, userId)`
- `addItem({ wishlistId, collectableId, manualText, notes, priority })`
- `removeItem(itemId, wishlistId)`
- `getItems(wishlistId, { limit, offset })`

### 2. [NEW] `api/controllers/wishlistController.js`
Endpoints:
- `listWishlists(req, res)` - GET /wishlists
- `createWishlist(req, res)` - POST /wishlists
- `getWishlist(req, res)` - GET /wishlists/:id
- `updateWishlist(req, res)` - PUT /wishlists/:id
- `deleteWishlist(req, res)` - DELETE /wishlists/:id
- `addItem(req, res)` - POST /wishlists/:id/items
- `removeItem(req, res)` - DELETE /wishlists/:id/items/:itemId
- `listItems(req, res)` - GET /wishlists/:id/items

### 3. [NEW] `api/routes/wishlists.js`
```javascript
router.use(auth);
router.get('/', listWishlists);
router.post('/', createWishlist);
router.get('/:id', getWishlist);
router.put('/:id', updateWishlist);
router.delete('/:id', deleteWishlist);
router.get('/:id/items', listItems);
router.post('/:id/items', addItem);
router.delete('/:id/items/:itemId', removeItem);
```

### 4. [MODIFY] `api/server.js`
Mount wishlist routes at `/wishlists`

## API Spec

### GET /wishlists
Returns all wishlists for current user.

### POST /wishlists
Body: `{ name, description, visibility }`

### POST /wishlists/:id/items
Body: `{ collectableId, manualText, notes, priority }`

## Verification
- [ ] Can create wishlist
- [ ] Can add items (collectable or manual text)
- [ ] Can remove items
- [ ] Visibility respected when viewing others' wishlists
