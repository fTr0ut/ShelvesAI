# Phase 5: Remove Auth0 & Finalize

## Overview
**Goal**: Remove Auth0 dependencies from mobile and backend, relying solely on local JWT authentication. Final cleanup and documentation.  
**Duration**: ~3-4 hours  
**Prerequisites**: Phase 4 complete

---

## Task 5.1: Remove Auth0 from Mobile App.js
**Priority**: 🔴 Critical | **Time**: 30 min

**Modify**: `mobile/src/App.js`

**Remove**:
```javascript
// Remove these imports if present
import * as WebBrowser from 'expo-web-browser';
WebBrowser.maybeCompleteAuthSession();

// Remove auth0 configuration block (lines ~63-78)
const auth0 = useMemo(() => {
  // ... remove entire block
}, [extra, scheme]);
```

**Update AuthContext**:
```javascript
export const AuthContext = createContext({
  token: '',
  setToken: () => {},
  apiBase: '',
  // Remove: auth0: null,
  needsOnboarding: false,
  setNeedsOnboarding: () => {},
});
```

**Update authValue**:
```javascript
const authValue = useMemo(() => ({
  token,
  setToken,
  apiBase,
  // Remove: auth0,
  needsOnboarding,
  setNeedsOnboarding,
}), [token, apiBase, needsOnboarding]);
```

**Acceptance Criteria**:
- [ ] Auth0 config removed from App.js
- [ ] AuthContext updated
- [ ] App still starts

---

## Task 5.2: Remove Auth0 from LoginScreen
**Priority**: 🔴 Critical | **Time**: 45 min

**Modify**: `mobile/src/screens/LoginScreen.js`

**Remove**:
- Auth0 imports
- `useAuthRequest` hook
- Auth0 login button
- Auth0 callback handling

**Keep**:
- Email/password login form
- Register flow
- Local JWT handling

**Example simplified login**:
```javascript
const handleLogin = async () => {
  setLoading(true);
  setError('');
  
  try {
    const response = await fetch(`${apiBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }
    
    await AsyncStorage.setItem('token', data.token);
    setToken(data.token);
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
};
```

**Acceptance Criteria**:
- [ ] Auth0 button removed
- [ ] Local login works
- [ ] Register works
- [ ] Token stored in AsyncStorage

---

## Task 5.3: Remove Auth0 Mobile Dependencies
**Priority**: 🔴 Critical | **Time**: 15 min

```bash
cd mobile
npm uninstall expo-auth-session expo-web-browser
```

**Update**: `mobile/package.json` - verify these are removed:
```diff
- "expo-auth-session": "~7.0.8",
- "expo-web-browser": "~15.0.7",
```

**Acceptance Criteria**:
- [ ] Packages uninstalled
- [ ] package.json updated
- [ ] npm install runs clean

---

## Task 5.4: Remove Auth0 from Backend
**Priority**: 🔴 Critical | **Time**: 30 min

**Modify**: `api/server.js`

**Remove** the entire Auth0 setup block (~lines 153-201):
```javascript
// Remove this entire try/catch block
try {
  const { auth: auth0Jwt } = require('express-oauth2-jwt-bearer');
  // ... all Auth0 configuration
} catch (e) {
  // Module not installed; skip silently
}
```

**Remove** any Auth0 routes (`/api/auth0/*`).

**Acceptance Criteria**:
- [ ] Auth0 middleware removed
- [ ] Auth0 routes removed
- [ ] Server starts without errors

---

## Task 5.5: Remove Auth0 Backend Dependencies
**Priority**: 🔴 Critical | **Time**: 15 min

```bash
cd api
npm uninstall express-oauth2-jwt-bearer
```

**Update**: `api/package.json` - verify removed:
```diff
- "express-oauth2-jwt-bearer": "^1.7.1",
```

**Acceptance Criteria**:
- [ ] Package uninstalled
- [ ] package.json updated

---

## Task 5.6: Test Complete Auth Flow
**Priority**: 🔴 Critical | **Time**: 30 min

**Test on mobile device**:

1. Fresh install (clear app data)
2. Register new account
3. Verify redirected to app
4. Logout
5. Login with same account
6. Verify access to shelves
7. Close and reopen app
8. Verify still logged in (token persisted)

**Test Checklist**:
- [ ] Register creates account
- [ ] Login returns token
- [ ] Token persists across app restart
- [ ] Protected routes work
- [ ] Logout clears token

---

## Task 5.7: Update Mobile Dependencies
**Priority**: 🟡 Medium | **Time**: 20 min

Run dependency audit:
```bash
cd mobile
npm audit
npm update
```

Remove any unused dependencies.

---

## Task 5.8: Update Environment Documentation
**Priority**: 🟡 Medium | **Time**: 30 min

**Update**: `api/.env.example`
- Remove Auth0 variables
- Ensure all required variables documented

**Update**: `mobile/app.json`
- Remove any Auth0-related extra config

---

## Task 5.9: Create Deployment Documentation
**Priority**: 🟡 Medium | **Time**: 45 min

**Create**: `DEPLOYMENT.md`

```markdown
# ShelvesAI Deployment Guide

## Prerequisites
- Docker and Docker Compose
- Node.js 18+
- Google Cloud account (for Vision API)
- Domain with SSL (for production)

## Local Development

### 1. Start Database
docker-compose up -d db

### 2. Configure Environment
cp api/.env.example api/.env
# Edit api/.env with your values

### 3. Start API
cd api
npm install
npm run dev

### 4. Start Mobile
cd mobile
npm install
npx expo start

## Production Deployment

### Self-Hosted
1. Set up PostgreSQL (Docker or managed)
2. Configure environment variables
3. Run API with PM2 or systemd
4. Set up reverse proxy (nginx/Caddy)

### Platform (Railway/Render)
1. Connect GitHub repository
2. Set root directory to `api`
3. Configure environment variables
4. Deploy
```

---

## Task 5.10: Final Verification
**Priority**: 🔴 Critical | **Time**: 1 hour

**Complete test of all features**:

- [ ] Register new user
- [ ] Login
- [ ] Create shelf (private, friends, public)
- [ ] Add item via catalog search
- [ ] Add item via manual entry
- [ ] Quick Scan (ML Kit OCR)
- [ ] Cloud Scan (Google Cloud Vision)
- [ ] View public feed
- [ ] Send friend request
- [ ] Accept friend request
- [ ] View friend's shelf
- [ ] Change shelf visibility
- [ ] Update profile
- [ ] Logout

---

## Completion Checklist
- [ ] Auth0 removed from mobile App.js
- [ ] Auth0 removed from LoginScreen
- [ ] Auth0 mobile packages removed
- [ ] Auth0 removed from backend server.js
- [ ] Auth0 backend package removed
- [ ] Complete auth flow tested
- [ ] Environment docs updated
- [ ] Deployment docs created
- [ ] All features verified working
