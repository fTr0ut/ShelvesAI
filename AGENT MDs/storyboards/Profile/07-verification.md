# Task 07: Verification

## Objective
Validate all profile and wishlist functionality works correctly.

## Automated Tests

### Create test files:
- `api/__tests__/profile.test.js`
- `api/__tests__/wishlists.test.js`

### Run:
```bash
cd api && npm test
```

## Manual Test Cases

### Profile Visibility
1. Create User A (private: true) and User B (private: false)
2. As unauthenticated user:
   - GET /profile/userB → should return public info
   - GET /profile/userA → should return limited info
3. As User B (not friend of A):
   - GET /profile/userA → should return limited info
4. Accept friendship between A and B:
   - GET /profile/userA as User B → should return full info

### Profile Photo Upload
1. Open app → Account → Edit Profile
2. Tap profile photo area
3. Select image from gallery
4. Verify upload progress indicator
5. Verify new photo displays
6. Restart app, verify photo persists

### Wishlist CRUD
1. Create wishlist "Books I Want" with friends visibility
2. Add item via search (find a book)
3. Add manual item "That one book from the store"
4. Verify both items appear
5. Delete the manual item
6. Verify deletion
7. Delete the wishlist

### Shelf Visibility on Profile
1. Create shelf with "friends" visibility
2. Add some items
3. View own profile → shelf should appear
4. View profile as non-friend → shelf should NOT appear
5. Become friends → shelf should appear

## Performance Checks
- [ ] Profile loads in < 2s
- [ ] Photo upload completes in < 5s
- [ ] Wishlist pagination works for 100+ items

## Edge Cases
- [ ] Empty bio displays gracefully
- [ ] No profile photo shows default avatar
- [ ] Very long bio truncates with "Read more"
- [ ] Deleted users don't break friend lists
