# Phase 2: Backend Migration to PostgreSQL

## Overview
**Goal**: Migrate all backend routes from MongoDB/Mongoose to PostgreSQL.  
**Duration**: ~8-12 hours  
**Prerequisites**: Phase 1 complete

---

## Task 2.1: Create Query Utilities
**Priority**: 🔴 Critical | **Time**: 30 min

Create `api/database/queries/utils.js` with helpers for dynamic UPDATE queries, pagination, and snake_case/camelCase conversion.

---

## Task 2.2: Migrate Auth Routes
**Priority**: 🔴 Critical | **Time**: 1.5 hours

**Create**: `api/database/queries/auth.js`
- `register({ email, password, username })` - Create user, return JWT
- `login({ email, password })` - Verify credentials, return JWT
- `verifyToken(token)` - Decode and validate JWT

**Update**: `api/routes/auth.js` to use new query functions.

---

## Task 2.3: Update Auth Middleware
**Priority**: 🔴 Critical | **Time**: 30 min

**Update**: `api/middleware/auth.js`
- Replace Mongoose User.findById with PostgreSQL query
- Keep same req.user attachment pattern

---

## Task 2.4: Create Shelves Query Module
**Priority**: 🔴 Critical | **Time**: 1 hour

**Create**: `api/database/queries/shelves.js`
- `listForUser(userId)` - Get user's shelves with item counts
- `getById(shelfId, userId)` - Get single shelf (ownership check)
- `getForViewing(shelfId, viewerId)` - Respects visibility/friendship
- `create({ userId, name, type, description, visibility })`
- `update(shelfId, userId, updates)`
- `remove(shelfId, userId)`
- `getItems(shelfId, userId)` - Get items with collectable/manual joins

---

## Task 2.5: Create Collectables Query Module
**Priority**: 🔴 Critical | **Time**: 1.5 hours

**Create**: `api/database/queries/collectables.js`
- `findByFingerprint(fingerprint)`
- `findByLightweightFingerprint(lwf)`
- `searchByTitle(term, kind, limit)` - Uses pg_trgm fuzzy search
- `upsert(data)` - Insert or update on conflict
- `addToShelf({ userId, shelfId, collectableId, ... })`
- `removeFromShelf(itemId, userId, shelfId)`

---

## Task 2.6: Create Friendships Query Module
**Priority**: 🟡 Medium | **Time**: 1 hour

**Create**: `api/database/queries/friendships.js`
- `getForUser(userId)` - List all friendships
- `getAcceptedFriendIds(userId)` - For visibility checks
- `sendRequest(requesterId, addresseeId, message)`
- `respond(friendshipId, userId, action)`
- `areFriends(userId1, userId2)`

---

## Task 2.7: Create Feed Query Module
**Priority**: 🟡 Medium | **Time**: 1 hour

**Create**: `api/database/queries/feed.js`
- `getPublicFeed({ limit, offset, type })`
- `getFriendsFeed(userId, { limit, offset, type })`
- `getMyFeed(userId, { limit, offset, type })`

Uses CTEs for friend visibility logic.

---

## Task 2.8: Update All Route Files
**Priority**: 🔴 Critical | **Time**: 2 hours

Update these files to use PostgreSQL queries:
- `api/routes/shelves.js`
- `api/routes/collectables.js`
- `api/routes/friends.js`
- `api/routes/feed.js`
- `api/routes/account.js`

Replace all Mongoose model imports with query module imports.

---

## Task 2.9: Remove Mongoose
**Priority**: 🔴 Critical | **Time**: 30 min

```bash
npm uninstall mongoose
mkdir -p _archive/mongoose-models
mv models/*.js _archive/mongoose-models/
```

Remove MongoDB connection from `server.js`.

---

## Task 2.10: Integration Testing
**Priority**: 🔴 Critical | **Time**: 1.5 hours

Test all endpoints with curl or Postman:
- POST /api/auth/register
- POST /api/auth/login
- GET /api/shelves
- POST /api/shelves
- GET /api/shelves/:id
- POST /api/shelves/:id/items
- GET /api/feed
- POST /api/friends/request

---

## Completion Checklist
- [ ] Auth queries + routes migrated
- [ ] Auth middleware uses PostgreSQL
- [ ] Shelves queries + routes migrated
- [ ] Collectables queries + routes migrated
- [ ] Friendships queries + routes migrated
- [ ] Feed queries + routes migrated
- [ ] Mongoose removed
- [ ] All endpoints tested
