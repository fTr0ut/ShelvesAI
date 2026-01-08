# Phase 7: Mobile UI Redesign

## Overview
**Goal**: Redesign the mobile app with modern, premium aesthetics. Focus on user experience, visual appeal, and intuitive navigation.  
**Duration**: ~12-20 hours  
**Prerequisites**: Phase 5 complete (core functionality working)

---

## Current Problems (Assessment)

Based on typical React Native app issues:
- Basic/default styling
- Inconsistent spacing and typography
- No cohesive color palette
- Missing micro-interactions
- Cluttered layouts
- Poor visual hierarchy
- Missing empty states
- No skeleton loaders

---

## Task 7.1: Create Design System
**Priority**: 🔴 Critical | **Time**: 2 hours

**Create**: `mobile/src/theme/index.js`

```javascript
// Color palette - Modern dark theme with accent
export const colors = {
  // Primary brand colors
  primary: '#6366F1',      // Indigo
  primaryLight: '#818CF8',
  primaryDark: '#4F46E5',
  
  // Backgrounds
  background: '#0F0F0F',
  surface: '#1A1A1A',
  surfaceElevated: '#252525',
  card: '#1F1F1F',
  
  // Text
  text: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textMuted: '#71717A',
  
  // Accents
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
  
  // Borders
  border: '#2A2A2A',
  borderLight: '#3A3A3A',
  
  // Gradients
  gradientStart: '#6366F1',
  gradientEnd: '#8B5CF6',
};

// Typography
export const typography = {
  // Font families (add to app.json)
  fontFamily: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
  },
  
  // Sizes
  sizes: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },
  
  // Line heights
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
};

// Spacing scale
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
};

// Border radius
export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

// Shadows (for iOS)
export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
};
```

**Acceptance Criteria**:
- [ ] Complete design system created
- [ ] Colors, typography, spacing, shadows defined
- [ ] Exportable and importable throughout app

---

## Task 7.2: Install Custom Fonts
**Priority**: 🔴 Critical | **Time**: 30 min

```bash
cd mobile
npx expo install expo-font @expo-google-fonts/inter
```

**Update**: `mobile/src/App.js`

```javascript
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;
  
  // ... rest of app
}
```

**Acceptance Criteria**:
- [ ] Inter font family installed
- [ ] Fonts load before app renders
- [ ] Splash screen hides after fonts ready

---

## Task 7.3: Create Reusable Components
**Priority**: 🔴 Critical | **Time**: 3 hours

**Create these components**:

### `mobile/src/components/ui/Button.js`
- Primary, secondary, ghost variants
- Loading state with spinner
- Disabled state
- Icon support (left/right)
- Haptic feedback

### `mobile/src/components/ui/Card.js`
- Elevated surface with subtle border
- Optional press handler
- Header/content/footer sections

### `mobile/src/components/ui/Input.js`
- Modern floating label
- Error state
- Icon prefix/suffix
- Character counter

### `mobile/src/components/ui/Avatar.js`
- Image with fallback initials
- Size variants (sm, md, lg)
- Online status indicator

### `mobile/src/components/ui/Badge.js`
- For item counts, status indicators
- Color variants

### `mobile/src/components/ui/Skeleton.js`
- Loading placeholder
- Shimmer animation

### `mobile/src/components/ui/EmptyState.js`
- Icon, title, description
- Optional action button

**Acceptance Criteria**:
- [ ] All UI components created
- [ ] Components use design system
- [ ] Consistent styling across all

---

## Task 7.4: Redesign Login Screen
**Priority**: 🔴 Critical | **Time**: 1.5 hours

**File**: `mobile/src/screens/LoginScreen.js`

**Design Goals**:
- Gradient background or subtle pattern
- Large app logo/brand
- Clean form with floating labels
- "Remember me" toggle
- Social login buttons (future)
- Link to register

**Key Changes**:
```javascript
// Replace plain TextInput with styled Input
<Input
  label="Email"
  value={email}
  onChangeText={setEmail}
  keyboardType="email-address"
  autoCapitalize="none"
  leftIcon="mail"
/>

// Replace plain button with styled Button
<Button
  title="Sign In"
  onPress={handleLogin}
  loading={loading}
  fullWidth
/>
```

**Acceptance Criteria**:
- [ ] Modern gradient or dark background
- [ ] App branding prominent
- [ ] Styled form inputs
- [ ] Loading states
- [ ] Error display styled

---

## Task 7.5: Redesign Shelves Screen (Home)
**Priority**: 🔴 Critical | **Time**: 2 hours

**File**: `mobile/src/screens/ShelvesScreen.js`

**Design Goals**:
- Grid or list toggle
- Shelf cards with cover previews
- Item count badges
- Pull-to-refresh
- Floating action button to create
- Empty state when no shelves

**Layout**:
```
┌─────────────────────────────────┐
│  Your Shelves          [+] FAB │
├─────────────────────────────────┤
│ ┌───────────┐ ┌───────────┐    │
│ │  📚       │ │  🎬       │    │
│ │  Books    │ │  Movies   │    │
│ │  42 items │ │  28 items │    │
│ └───────────┘ └───────────┘    │
│ ┌───────────┐ ┌───────────┐    │
│ │  🎮       │ │  💿       │    │
│ │  Games    │ │  Vinyl    │    │
│ │  156 items│ │  12 items │    │
│ └───────────┘ └───────────┘    │
└─────────────────────────────────┘
```

**Acceptance Criteria**:
- [ ] Grid layout with shelf cards
- [ ] Visual icons per shelf type
- [ ] Item counts displayed
- [ ] FAB for creating new shelf
- [ ] Empty state component
- [ ] Pull-to-refresh

---

## Task 7.6: Redesign Shelf Detail Screen
**Priority**: 🔴 Critical | **Time**: 3 hours

**File**: `mobile/src/screens/ShelfDetailScreen.js`

**Design Goals**:
- Header with shelf info and stats
- Item grid with cover images
- Sort/filter pills
- Quick scan FAB
- Swipe actions (delete, edit)
- Search bar

**Layout**:
```
┌─────────────────────────────────┐
│ ← My Books              ⚙️ •••  │
├─────────────────────────────────┤
│  📚 42 items • Private          │
├─────────────────────────────────┤
│ 🔍 Search items...              │
├─────────────────────────────────┤
│ [A-Z] [Author] [Rating] [Date]  │
├─────────────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐        │
│ │cover│ │cover│ │cover│        │
│ │     │ │     │ │     │        │
│ │Title│ │Title│ │Title│        │
│ │Auth │ │Auth │ │Auth │        │
│ └─────┘ └─────┘ └─────┘        │
│        ... more items ...       │
└─────────────────────────────────┘
         [📷 Scan] FAB
```

**Acceptance Criteria**:
- [ ] Clean header with stats
- [ ] Item grid with covers
- [ ] Sort pills horizontal scroll
- [ ] Search functionality
- [ ] Scan FAB prominent
- [ ] Skeleton loading states

---

## Task 7.7: Redesign Item Detail Screen
**Priority**: 🟡 Medium | **Time**: 1.5 hours

**File**: `mobile/src/screens/CollectableDetailScreen.js`

**Design Goals**:
- Large cover image hero
- Metadata in clean sections
- Rating component (stars/slider)
- Notes editor
- Action buttons (edit, delete, share)

**Acceptance Criteria**:
- [ ] Hero image section
- [ ] Organized metadata
- [ ] Interactive rating
- [ ] Edit capabilities
- [ ] Share functionality

---

## Task 7.8: Redesign Social/Feed Screen
**Priority**: 🟡 Medium | **Time**: 1.5 hours

**File**: `mobile/src/screens/SocialFeedScreen.js`

**Design Goals**:
- Feed cards with user avatar
- Shelf preview thumbnails
- Like/comment placeholders
- Tab bar for Public/Friends/My
- Infinite scroll

**Acceptance Criteria**:
- [ ] Feed cards designed
- [ ] User info displayed
- [ ] Tab navigation
- [ ] Pull-to-refresh
- [ ] Loading states

---

## Task 7.9: Redesign Account Screen
**Priority**: 🟡 Medium | **Time**: 1 hour

**File**: `mobile/src/screens/AccountScreen.js`

**Design Goals**:
- Profile header with avatar
- Stats row (shelves, items, friends)
- Settings sections grouped
- Danger zone for logout/delete
- Version info footer

**Acceptance Criteria**:
- [ ] Profile header
- [ ] Stats display
- [ ] Grouped settings
- [ ] Logout prominent

---

## Task 7.10: Add Animations & Micro-interactions
**Priority**: 🟡 Medium | **Time**: 2 hours

**Install**:
```bash
npx expo install react-native-reanimated
```

**Add to**:
- Button press scale effect
- Card press feedback
- List item entrance animations
- Pull-to-refresh custom animation
- Tab bar animations
- Modal slide animations
- Skeleton shimmer effect

**Acceptance Criteria**:
- [ ] Reanimated configured
- [ ] Button animations
- [ ] List animations
- [ ] Smooth transitions

---

## Task 7.11: Add Haptic Feedback
**Priority**: 🟢 Low | **Time**: 30 min

```bash
npx expo install expo-haptics
```

**Add haptics to**:
- Button presses
- Successful actions
- Error states
- Pull-to-refresh trigger

---

## Task 7.12: Update App Icon and Splash
**Priority**: 🟡 Medium | **Time**: 1 hour

**Create assets**:
- App icon (1024x1024)
- Adaptive icon (Android)
- Splash screen

**Update**: `mobile/app.json`
```json
{
  "expo": {
    "icon": "./assets/icon.png",
    "splash": {
      "image": "./assets/splash.png",
      "backgroundColor": "#0F0F0F"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#0F0F0F"
      }
    }
  }
}
```

---

## Task 7.13: Final Polish & QA
**Priority**: 🔴 Critical | **Time**: 2 hours

**Checklist**:
- [ ] All screens use design system
- [ ] Consistent spacing throughout
- [ ] Typography hierarchy clear
- [ ] Colors consistent
- [ ] Loading states everywhere
- [ ] Empty states everywhere
- [ ] Error states styled
- [ ] Keyboard avoiding works
- [ ] Safe area insets respected
- [ ] Dark mode consistent
- [ ] Accessibility labels added
- [ ] Test on multiple screen sizes

---

## Screen Redesign Priority Order

| Screen | Priority | Complexity | Order |
|--------|----------|------------|-------|
| LoginScreen | High | Medium | 1 |
| ShelvesScreen | High | Medium | 2 |
| ShelfDetailScreen | High | High | 3 |
| CollectableDetailScreen | Medium | Medium | 4 |
| SocialFeedScreen | Medium | Medium | 5 |
| AccountScreen | Medium | Low | 6 |
| ShelfCreateScreen | Low | Low | 7 |
| FriendSearchScreen | Low | Medium | 8 |

---

## Completion Checklist
- [ ] Design system created
- [ ] Custom fonts installed
- [ ] UI components library created
- [ ] LoginScreen redesigned
- [ ] ShelvesScreen redesigned
- [ ] ShelfDetailScreen redesigned
- [ ] CollectableDetailScreen redesigned
- [ ] SocialFeedScreen redesigned
- [ ] AccountScreen redesigned
- [ ] Animations added
- [ ] Haptics added
- [ ] App icon/splash updated
- [ ] Final QA passed
