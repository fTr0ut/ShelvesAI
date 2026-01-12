# Task 02: Backend Profile API

## Objective
Create profile endpoints for viewing/editing profiles and uploading photos.

## Files to Create/Modify

### 1. [NEW] `api/database/queries/profileMedia.js`
Functions:
- `createProfileMedia({ userId, kind, sourceUrl, localPath, contentType, sizeBytes, checksum })`
- `getForUser(userId)`
- `deleteForUser(userId)`

### 2. [MODIFY] `api/database/queries/users.js`
Add functions:
- `getPublicProfile(username, viewerId)` - returns profile respecting privacy
- `updateProfile` - add 'bio' to allowed fields

### 3. [MODIFY] `api/database/queries/shelves.js`
Add function:
- `listVisibleForUser(ownerId, viewerId)` - returns shelves viewer can see

### 4. [NEW] `api/controllers/profileController.js`
Endpoints:
- `getMyProfile(req, res)` - GET /profile
- `updateMyProfile(req, res)` - PUT /profile
- `uploadPhoto(req, res)` - POST /profile/photo
- `getPublicProfile(req, res)` - GET /profile/:username
- `getProfileShelves(req, res)` - GET /profile/:username/shelves

### 5. [NEW] `api/routes/profile.js`
```javascript
router.get('/', auth, getMyProfile);
router.put('/', auth, updateMyProfile);
router.post('/photo', auth, uploadPhoto);
router.get('/:username', optionalAuth, getPublicProfile);
router.get('/:username/shelves', optionalAuth, getProfileShelves);
```

### 6. [MODIFY] `api/server.js`
Mount profile routes at `/profile`

## API Spec

### GET /profile
Returns current user's full profile.

### PUT /profile
Body: `{ bio, firstName, lastName, city, state, country, isPrivate }`

### POST /profile/photo
Multipart form with `photo` field.

### GET /profile/:username
Returns public profile. Honours `is_private` flag.

### GET /profile/:username/shelves
Returns shelves visible to the viewer.

## Verification
- [ ] Can fetch own profile
- [ ] Can update bio
- [ ] Can upload profile photo
- [ ] Private profiles hidden from non-friends
