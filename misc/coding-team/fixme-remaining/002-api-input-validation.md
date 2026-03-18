# 002 — API Input Validation: UUID, Length, parseInt

## Context

Three related validation gaps exist across the API:

1. **SEC-14**: `validateUUID` middleware is only applied to 5 route params across 3 files. Routes in `shelves.js`, `lists.js`, and others lack it entirely.
2. **SEC-15**: No max-length validation on any user-input string fields (titles, descriptions, tags, search queries, bios, notes).
3. **BUG-8**: `parseInt` is used on route params (e.g., `collectables.js:305`) without NaN checks. `parseInt("abc", 10)` returns `NaN`, which silently returns no results instead of 400.

## Objective

Add consistent input validation across all API routes.

## Scope

### UUID validation (SEC-14)

Apply `validateUUID` from `api/middleware/validate.js` to all route params that accept UUIDs. Key files:

- `api/routes/shelves.js` — note: `shelfId` and `itemId` are integers here, not UUIDs. Only apply to params that are actually UUIDs (check the DB schema).
- `api/routes/lists.js`
- `api/routes/friends.js` — already has it on `targetUserId`, but missing on `DELETE /:id` and `POST /respond` body field `friendshipId`
- Any other route files with UUID params

**Important**: Only validate params that are actually UUIDs per the database schema. Shelf IDs, collectable IDs, list IDs, etc. are `SERIAL` (integers), not UUIDs. User IDs and notification IDs are UUIDs.

### Integer param validation (BUG-8)

Create a `validateIntParam(paramNames)` middleware in `api/middleware/validate.js` that:
- Parses the named params with `parseInt(value, 10)`
- Returns 400 if result is `NaN`, negative, or not finite
- Apply to all routes that use integer IDs (shelf, collectable, list, wishlist, item IDs)

### String length validation (SEC-15)

Create a `validateStringLengths(fieldLimits)` middleware in `api/middleware/validate.js` that:
- Takes an object like `{ title: 500, description: 5000, name: 200 }`
- Checks `req.body` fields against max lengths
- Returns 400 with details if any exceed limits

Apply to routes that accept user-input strings. Reasonable defaults:
- `name`/`title`: 500 chars
- `description`/`bio`/`note`: 5000 chars
- `tags` (each element): 100 chars
- `search`/`query` params: 500 chars
- `content` (comments): 2000 chars

## Non-goals

- Do not change the `validateUUID` function signature or behavior.
- Do not add validation to admin-only routes (lower risk).
- Do not add request body schema validation (e.g., Joi/Zod) — that's a larger refactor.

## Constraints

- The existing `validateUUID` only validates if a value is present (absent = pass). Keep this behavior.
- `validateIntParam` should similarly only validate if the param exists in `req.params`.
- Don't break existing API contracts — these are additive guards that reject bad input, not changes to what valid input looks like.
