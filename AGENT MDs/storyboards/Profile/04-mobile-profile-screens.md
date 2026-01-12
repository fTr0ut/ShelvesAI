# Task 04: Mobile Profile Screens

## Objective
Create ProfileScreen for viewing profiles and ProfileEditScreen for editing.

## Files to Create

### 1. [NEW] `mobile/src/screens/ProfileScreen.js`
Display:
- Profile photo (large, circular)
- Username and display name
- Bio/description
- Location (city, state, country)
- Stats (shelf count, item count)
- List of visible shelves as cards
- "Add Friend" button (if not self, not already friends)
- "Edit Profile" button (if viewing own profile)
- Link to wishlists

Props: `route.params.username` (optional - if missing, show current user)

### 2. [NEW] `mobile/src/screens/ProfileEditScreen.js`
Editable fields:
- Profile photo (tap to change via expo-image-picker)
- First name, Last name
- Bio (multiline text input)
- City, State, Country
- Privacy toggle (is_private)

Actions:
- Save button → PUT /profile
- Photo picker → POST /profile/photo

### 3. [NEW] `mobile/src/components/ProfileHeader.js`
Reusable component:
- Profile photo with edit overlay
- Username display
- Stats row

## UI Design Notes
- Use existing theme from `theme/`
- Profile photo: 120px circular with border
- Bio: max 500 chars, multiline
- Shelves: horizontal scroll of cards (like on SocialFeedScreen)
- Follow warm color palette established in app

## Verification
- [ ] ProfileScreen displays user info correctly
- [ ] ProfileEditScreen saves changes
- [ ] Photo picker works on iOS/Android
- [ ] Private profile shows minimal info to non-friends
