# ShelvesAI Audit TODO/FIXME

Last updated: 2026-03-17
Audit scope: `api`, `mobile`, `admin-dashboard`, `AGENTS`, root config, docker-compose

## Notes
- `is_premium` self-toggle in account settings is intentional right now (product decision), so it is not listed as a bug.
- 67 findings total: 9 Critical, 14 High, 30 Medium, 14 Low. 54 resolved.

## Progress Update (2026-03-17)

### Completed
- Critical: `SEC-1`, `SEC-2`, `SEC-3`, `SEC-4`, `SEC-5`, `BUG-1`, `BUG-2`, `DEBT-1`, `DEBT-2`
- High: `SEC-6`, `SEC-7`, `SEC-8`, `SEC-9`, `SEC-10`, `SEC-11`, `SEC-12`, `SEC-13`, `BUG-3`, `BUG-4`, `BUG-5`, `BUG-6`, `BUG-13`, `DEBT-3`
- Medium security: `SEC-14`, `SEC-16`, `SEC-17`, `SEC-19`, `SEC-20`, `SEC-21`
- Medium bugs: `BUG-7`, `BUG-8`, `BUG-9`, `BUG-10`, `BUG-11`, `BUG-12`, `BUG-14`, `BUG-15`, `BUG-18`, `BUG-19`, `BUG-20`, `BUG-21`
- Medium security (input validation): `SEC-15`
- Medium debt: `DEBT-4`, `DEBT-5`, `DEBT-6`
- Medium duplicates: `DUP-1`, `DUP-2`, `DUP-3`, `DUP-4`, `DUP-5`, `DUP-6`, `DUP-7`, `DUP-8`, `DUP-9`

### Partially Completed
- `SEC-18`: security headers were added in admin Vite config (dev/preview), but production deployment/web server headers still need to be enforced at the hosting layer.

---

## Critical Priority

### SEC-1: Password Reset Token Logged to Console
- **Severity**: Critical
- **Risk**: Credential token leakage in logs, monitoring dashboards, CI/CD output.
- **File**: `api/services/emailService.js:31`
- **Detail**: When `SENDGRID_API_KEY` is not configured, the password reset token is printed in plaintext:
  ```javascript
  console.log(`[EmailService] Would send reset email to ${to} with token: ${token}`);
  ```
  Tokens become visible in server stdout, CloudWatch/ELK, Datadog, and any log aggregator.
- **OWASP**: A01:2021 – Broken Access Control. CWE-532: Insertion of Sensitive Information into Log File.
- **TODO**:
  - Remove token from log message entirely. Log only recipient email and a success/failure flag.
  - In non-dev environments, fail closed when mail transport is unavailable instead of falling back to console.

### SEC-2: Catalog Write Endpoints Missing Admin Auth
- **Severity**: Critical
- **Risk**: Any authenticated user can create or modify global catalog entries if `ALLOW_CATALOG_WRITE=true`.
- **Files**:
  - `api/routes/collectables.js:73-77` — `POST /api/collectables` checks only env var, no role check
  - `api/routes/collectables.js:315` — `PUT /api/collectables/:collectableId` same issue
  - `api/routes/collectables.js:131` — `POST /api/collectables/from-news`
- **Detail**: The POST endpoint guards on `String(process.env.ALLOW_CATALOG_WRITE).toLowerCase() !== "true"` but does NOT verify the user is an admin. If the env var is set (even accidentally), any authenticated user can pollute the global catalog with arbitrary entries.
- **OWASP**: A01:2021 – Broken Access Control. CWE-639: Authorization Bypass Through User-Controlled Key.
- **TODO**:
  - Add `requireAdmin` middleware to `POST /`, `POST /from-news`, and `PUT /:collectableId`.
  - Keep env var as an additional feature flag if desired, but never as the sole gate.
  - Keep search/read endpoints user-authenticated or optional-auth as desired.

### SEC-3: File Upload Missing Magic Number Validation
- **Severity**: Critical
- **Risk**: Executable files or malicious payloads uploaded disguised as images. EXIF bombs, XXE-laden SVGs, ImageMagick payloads.
- **Files**:
  - `api/routes/profile.js:14-26` — multer `fileFilter` checks only `file.mimetype` (client-controlled header)
  - `api/routes/shelves.js` — vision upload uses same pattern
  - `api/controllers/profileController.js:101-120`
  - `api/database/queries/media.js:185` — media ingestion accepts non-image payloads and can poison local cache
- **Detail**: Multer's `fileFilter` trusts the client-provided MIME type:
  ```javascript
  fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
          cb(null, true);
      } else {
          cb(new Error('Only image files are allowed'));
      }
  }
  ```
  A client can forge `Content-Type: image/jpeg` on any binary data.
- **OWASP**: A04:2021 – Insecure Design. CWE-434: Unrestricted Upload of File with Dangerous Type.
- **TODO**:
  - Add `file-type` package to validate magic bytes after upload.
  - Whitelist only `image/jpeg`, `image/png`, `image/webp`.
  - Validate image dimensions (reject > 4096x4096).
  - For media ingestion: verify response MIME and magic bytes before write, enforce strict redirect and host validation for remote cover fetch, reject non-image responses.

### SEC-4: Admin Token Stored in SessionStorage (XSS-Vulnerable)
- **Severity**: Critical
- **Risk**: Any JavaScript running on the page (including XSS payloads) can read the admin JWT.
- **File**: `admin-dashboard/src/context/AuthContext.jsx:4, 14-15, 43-44`
- **Detail**:
  ```javascript
  const storage = typeof window !== 'undefined' ? window.sessionStorage : null;
  // ...
  storage?.setItem('adminToken', token);
  storage?.setItem('adminUser', JSON.stringify(userData));
  ```
  SessionStorage is accessible to all JavaScript in the same origin. A single XSS vulnerability exposes the admin token.
- **TODO**:
  - Migrate to HTTP-only secure cookies (requires API-side cookie-setting on login).
  - Set `Secure`, `HttpOnly`, `SameSite=Strict` flags.
  - Remove all `sessionStorage` token handling.

### SEC-5: No CSRF Protection on Admin Login/Actions
- **Severity**: Critical
- **Risk**: Cross-site request forgery can trigger admin login, suspension, or privilege changes.
- **File**: `admin-dashboard/src/pages/Login.jsx:24`
- **Detail**: No CSRF token is generated, sent, or validated on any admin endpoint. A malicious website could craft requests to `/api/admin/login` or admin action endpoints.
- **TODO**:
  - Implement CSRF tokens (double-submit cookie pattern or synchronizer token).
  - Validate CSRF token on all state-changing admin endpoints.

### BUG-1: Password Reset Race Condition (TOCTOU)
- **Severity**: Critical
- **Risk**: Two concurrent requests can both validate the same token, leading to unpredictable password overwrites.
- **File**: `api/database/queries/passwordReset.js:77-95`
- **Detail**: Token is validated in one query (`validateResetToken`), then password is updated and token marked used in separate queries. Between the check and use, another request can also validate the same token:
  ```javascript
  async function resetPassword(token, newPassword) {
      const validation = await validateResetToken(token);  // Check
      if (!validation.valid) { return { success: false, error: validation.error }; }
      const passwordHash = await bcrypt.hash(newPassword, 10);
      // ← Window: Another request could use same token here
      await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, validation.userId]);
      await query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE token = $1`, [token]);
  }
  ```
- **TODO**:
  - Use atomic database operation:
    ```sql
    UPDATE password_reset_tokens
    SET used_at = NOW()
    WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
    RETURNING user_id
    ```
  - Only update user password if the RETURNING clause yields a row.

### BUG-2: Auth Cache Eviction Is FIFO, Not LRU
- **Severity**: Critical
- **Risk**: Cache grows unbounded under certain access patterns. Frequently accessed old keys never evicted. Potential memory exhaustion / DoS.
- **File**: `api/middleware/auth.js:24-27`
- **Detail**:
  ```javascript
  if (authCache.size > AUTH_CACHE_MAX_ENTRIES) {
      const oldestKey = authCache.keys().next().value;
      if (oldestKey) authCache.delete(oldestKey);
  }
  ```
  `Map.keys().next().value` returns the first-inserted key (FIFO), not the least-recently-used. If a key is deleted and re-inserted (re-auth), it moves to the end. Under sustained load from the same users, the eviction never reaches them.
- **CWE-770**: Allocation of Resources Without Limits or Throttling.
- **TODO**:
  - Replace with `lru-cache` package or implement proper LRU with access-time tracking.
  - Set both `max` (entry count) and `ttl` (time-to-live) on the cache.

### DEBT-1: Stale/Broken Test Files
- **Severity**: Critical (blocks CI/CD)
- **Risk**: `npm run test:backend` fails (12 suites). Masks real test failures. Wastes developer time.
- **Files**:
  - `api/__tests__/steam-openid.test.js` — references disabled Steam routes
  - `api/__tests__/steam-openid-listener.test.js` — same
  - `api/__tests__/ui-canvas-routes.test.js` — references non-existent UI canvas feature
  - `api/__tests__/ui-canvas-store.test.js` — same
  - `api/__tests__/ui-project-settings.test.js` — same
  - `api/__tests__/ui-publish-bundle.test.js` — same
  - `api/__tests__/cleanup-notif-users.js` — utility script, not a test, but in test directory
- **Evidence**: Steam routes commented out in `api/server.js:31-33`. Documented in AGENTS/debug_scripts.md as tracked operational risk.
- **TODO**:
  - Delete or archive stale test files (`steam-*.test.js`, `ui-*.test.js`).
  - Move `cleanup-notif-users.js` to `api/scripts/`.
  - Update `jest.config.js` to exclude archived/utility files.
  - Verify remaining tests pass green.

### DEBT-2: Incomplete Batch Favorites for Manual Items
- **Severity**: Critical (feature parity broken)
- **Risk**: `checkFavoritesBatch` endpoint silently returns incomplete results for manual items. Frontend receives `{ status: {} }` without manual IDs.
- **File**: `api/controllers/favoritesController.js:171-208`
- **Detail**: The endpoint accepts `manualIds` array but the query logic is unimplemented. Contains extensive inline comments explaining the gap:
  ```javascript
  if (manualIds && Array.isArray(manualIds) && manualIds.length > 0) {
      // Re-using getFavoritesStatus logic if I update it?
      // ...I'll leave a TODO or simple loop.
      // Actually better: I'll accept manualIds but if logic is missing, return false.
  }
  ```
- **TODO**:
  - Implement `getManualFavoritesStatus` in `api/database/queries/favorites.js`.
  - Wire into the batch controller response.
  - Remove placeholder comments from production controller.
  - OR: Remove `manualIds` from the endpoint contract if not needed yet.

---

## High Priority

### SEC-6: Weak Admin Rate Limiting
- **Severity**: High
- **Risk**: Admin login allows 5 attempts per 15 minutes — same as password reset, no exponential backoff, no account lockout.
- **File**: `api/routes/admin.js:10-16`
- **Detail**:
  ```javascript
  const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many attempts. Please try again later.' },
  });
  ```
  Admin accounts are high-value targets. 5 attempts may be insufficient for coordinated attacks.
- **OWASP**: A07:2021 – Identification and Authentication Failures.
- **TODO**:
  - Reduce to 3 attempts per window.
  - Add `skipSuccessfulRequests: true`.
  - Use persistent rate store (Redis) for multi-instance deployments.
  - Log admin brute force attempts with IP address.
  - Consider exponential backoff or account lockout after repeated failures.

### SEC-7: Hardcoded Ngrok Domain in CORS Allowlist
- **Severity**: High
- **Risk**: Development ngrok URL hardcoded in production CORS config. Ngrok URLs are reusable by others if session expires.
- **File**: `api/server.js:101-106`
- **Detail**:
  ```javascript
  const defaultCorsOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://nonresilient-rylan-nondebilitating.ngrok-free.dev'  // ← Dev domain
  ];
  ```
- **CWE-798**: Use of Hard-Coded Credentials.
- **TODO**:
  - Remove hardcoded ngrok URL from source.
  - Use env var `CORS_ORIGINS` (comma-separated) for additional origins.
  - Only include localhost origins in development mode.

### SEC-8: No Admin Session Inactivity Timeout
- **Severity**: High
- **Risk**: Admin session persists indefinitely. Unattended admin terminal accessible to anyone with physical access.
- **File**: `admin-dashboard/src/context/AuthContext.jsx`
- **Detail**: No inactivity timer, no session expiry check. Once logged in, admin stays logged in until browser tab is closed (sessionStorage) or manual logout.
- **TODO**:
  - Implement 15-30 minute inactivity timeout.
  - Track last activity timestamp.
  - Auto-logout and redirect to login on timeout.

### SEC-9: Client-Side-Only JWT Validation in Admin Dashboard
- **Severity**: High
- **Risk**: Admin UI only checks stored `isAdmin` flag from sessionStorage, never validates JWT signature.
- **File**: `admin-dashboard/src/context/AuthContext.jsx:19-20`
- **Detail**:
  ```javascript
  if (parsed?.isAdmin) {
    setUser(parsed);
  ```
  The stored user object could be tampered with in sessionStorage.
- **TODO**:
  - This is acceptable for UI gating only if ALL API calls validate JWT server-side.
  - Verify that every admin API endpoint validates the JWT and checks admin role server-side.
  - Add a comment documenting this is intentionally informational-only.

### SEC-10: HTTP Protocol Allowed for Admin API
- **Severity**: High
- **Risk**: Admin tokens transmitted over unencrypted HTTP. Man-in-the-middle attack possible.
- **File**: `admin-dashboard/src/api/client.js:3`
- **Detail**:
  ```javascript
  const API_URL = import.meta.env.VITE_API_URL || '/api';
  ```
  `VITE_API_URL` can be configured to `http://` with no validation.
- **TODO**:
  - Add URL protocol validation at app startup in production builds.
  - Reject non-HTTPS URLs when `import.meta.env.PROD` is true.

### SEC-11: Insecure Token Storage in Mobile App
- **Severity**: High
- **Risk**: JWT stored in plaintext AsyncStorage on device. Extractable on rooted/jailbroken devices.
- **File**: `mobile/src/services/api.js:12-27`
- **Detail**: `saveToken()` writes to AsyncStorage without encryption. No token format validation. No token expiration checking. No token refresh mechanism — expired tokens cause hard logout.
- **TODO**:
  - Migrate to `expo-secure-store` for token storage.
  - Add token expiration validation before each API call.
  - Implement token refresh mechanism to avoid hard logouts.

### SEC-12: Hardcoded Fallback Secrets in API
- **Severity**: High
- **Risk**: If env vars are missing in production, insecure default secrets are used. JWT_SECRET fallback means tokens are predictable.
- **Files**:
  - `api/server.js:148` — JWT_SECRET fallback
  - `api/knexfile.js:17` — DB credentials fallback
- **Detail**: Documented in existing FIXME.md but not yet addressed.
- **TODO**:
  - Add startup validation: crash if `JWT_SECRET`, `DATABASE_URL`, or DB credentials are missing when `NODE_ENV !== 'development'`.
  - Remove hardcoded fallback values entirely, or gate them behind `NODE_ENV === 'development'` check.

### SEC-13: Hardcoded Default Database Credentials in Docker Compose
- **Severity**: High
- **Risk**: If environment variables are missing, weak default credentials are used: `localdev123` for Postgres, `admin` for pgAdmin.
- **File**: `docker-compose.yml:10, 29-30`
- **Detail**:
  ```yaml
  POSTGRES_PASSWORD: ${DB_PASSWORD:-localdev123}
  PGADMIN_DEFAULT_EMAIL: admin@local.dev
  PGADMIN_DEFAULT_PASSWORD: admin
  ```
- **TODO**:
  - Remove default values or clearly document they are for local development only.
  - Add a startup check script that warns/fails if defaults are used in production.

### BUG-3: Commented-Out Favorites Event Logging
- **Severity**: High
- **Risk**: Feed is inconsistent — some user actions are logged, favorites are not. Social feeds won't show favorite activity. Discover/personalization can't use favorite signals.
- **File**: `api/controllers/favoritesController.js:90-102`
- **Detail**: Feed event logging for favorites is entirely commented out:
  ```javascript
  // Log feed event
  // Log feed event  (duplicate comment)
  /*
  try {
      await feedQueries.logEvent({
          userId: req.user.id,
          shelfId: null,
          eventType: 'item.favorited',
          payload: logPayload,
      });
  } catch (e) {
      console.warn('Failed to log favorite event:', e.message);
  }
  */
  ```
  Violates event logging design documented in `AGENTS/event-system.md`.
- **TODO**:
  - If favorites should appear in feed: uncomment the logging code.
  - If intentionally disabled: replace block comment with a clear design note explaining why.

### BUG-4: Missing JSON Parse in Feed normalizePayload
- **Severity**: High
- **Risk**: If payload is stored as JSON string (from some adapters), it passes through unparsed. Frontend receives `{"key": "value"}` (string) instead of `{key: "value"}` (object).
- **File**: `api/database/queries/feed.js:8-11`
- **Detail**:
  ```javascript
  function normalizePayload(payload) {
    if (payload && typeof payload === 'object') return payload;
    return {};
  }
  ```
  No attempt to parse string payloads.
- **TODO**:
  - Add string parsing:
    ```javascript
    if (typeof payload === 'string') {
      try { return JSON.parse(payload); } catch { return {}; }
    }
    ```

### BUG-5: Boolean Filter Type Coercion in Admin Dashboard
- **Severity**: High
- **Risk**: Filter dropdowns send `"false"` (string) which is truthy in JavaScript. If backend evaluates as boolean, the active/suspended filter may be inverted.
- **File**: `admin-dashboard/src/pages/Users.jsx:75-92`
- **Detail**:
  ```javascript
  <select value={filters.suspended} onChange={(e) => handleFilterChange('suspended', e.target.value)}>
    <option value="">All Status</option>
    <option value="false">Active</option>
    <option value="true">Suspended</option>
  </select>
  ```
  When value is `"false"` (string), it's truthy: `if ("false") { ... } // true!`
- **TODO**:
  - Convert to actual boolean before API call: `value === 'true' ? true : value === 'false' ? false : undefined`.
  - Or use `"0"`/`"1"` values.
  - Or handle string comparison explicitly on both ends.

### BUG-6: No Unsuspend Confirmation Dialog in Admin
- **Severity**: High
- **Risk**: `handleUnsuspend()` executes immediately with no confirmation, unlike `handleToggleAdmin()` which has `confirm()`. Accidental restoration of suspended accounts possible.
- **File**: `admin-dashboard/src/components/UserDetailModal.jsx:46-56`
- **Detail**:
  ```javascript
  async function handleUnsuspend() {
    try {
      setActionLoading(true);
      await unsuspendUser(userId);
      // No confirmation dialog!
  ```
  Compare to `handleToggleAdmin()` at line 60: `if (!confirm(...))`.
- **TODO**:
  - Add `if (!confirm('Are you sure you want to unsuspend this user?')) return;` before executing.

### DEBT-3: Feed Social Actions Validate Event Existence but Not Visibility
- **Severity**: High
- **Risk**: Users may interact with events they should not have access to (e.g., private feed events from non-friends).
- **Files**:
  - `api/controllers/eventSocialController.js:10`
  - `api/database/queries/eventSocial.js:5`
- **TODO**:
  - Add centralized visibility check used by like/comment/read-comment paths.
  - Verify the requesting user has permission to view the event before allowing interaction.

---

## Medium Priority

### Security

#### SEC-14: Missing UUID Validation on Many Routes
- **Risk**: Non-UUID parameters could cause type confusion or logic errors.
- **Files**: Multiple routes in `api/routes/shelves.js`, `api/routes/lists.js` etc. lack `validateUUID` middleware. Compare with `api/routes/favorites.js:15-16` which correctly validates.
- **TODO**: Apply `validateUUID` middleware consistently to all user-related route parameters.

#### SEC-15: Missing Input Length Validation on API String Fields
- **Risk**: Extremely long strings could cause memory/performance issues.
- **Files**: Multiple controllers accept string fields without length limits.
- **TODO**: Add max-length validation to all user-input string fields (titles, descriptions, tags, search queries).

#### SEC-16: Missing Timeouts on External API Calls
- **Risk**: Slow/hanging external API responses cause request queuing, thread pool exhaustion, cascading failures.
- **Files**:
  - `api/services/googleGemini.js`
  - `api/services/catalog/TmdbAdapter.js`
  - `api/services/catalog/IgdbAdapter.js`
  - `api/services/hardcover.js`
- **TODO**:
  - Add timeout wrapper (e.g., `Promise.race` with 10-second timeout) to all external API calls.
  - Consider implementing circuit breaker pattern for external services.

#### SEC-17: Admin User Image URLs Rendered Without Validation
- **Risk**: User-provided image URL could serve XSS via data URL or point to malicious content.
- **File**: `admin-dashboard/src/components/UserDetailModal.jsx:99-104`
- **Detail**: `<img src={user.picture} .../>` renders user-controlled URL without domain whitelisting.
- **TODO**: Whitelist allowed image domains. Validate that protocol is `https://`.

#### SEC-18: Missing Security Headers on Admin Dashboard
- **Risk**: XSS, clickjacking, and MIME-sniffing attacks.
- **Files**: `admin-dashboard/vite.config.js`, deployment config
- **TODO**:
  - Add `Content-Security-Policy` header.
  - Add `X-Frame-Options: DENY` (admin should never be framed).
  - Add `X-Content-Type-Options: nosniff`.

#### SEC-19: No HTTPS Enforcement in Mobile guessApiBase
- **Risk**: API base could resolve to `http://` in some environments, exposing auth tokens in transit.
- **File**: `mobile/src/App.js:84-103`
- **Detail**: `guessApiBase()` has 5 fallback paths including `http://` variants. No validation that the resolved URL uses HTTPS.
- **TODO**: Enforce HTTPS in production builds. Only allow `http://` in `__DEV__` mode.

#### SEC-20: Missing Search Debounce in Admin Dashboard
- **Risk**: API flood — every keystroke fires an API request.
- **File**: `admin-dashboard/src/pages/Users.jsx:70`
- **Detail**: `onChange={(e) => setSearch(e.target.value)}` triggers `loadUsers()` via useEffect on every character.
- **TODO**: Add 300-500ms debounce on the search input.

#### SEC-21: Broad 401 Error Handling Creates Logout Loop Risk
- **Risk**: If login endpoint returns 401, creates infinite logout loop. Could also cause logout on non-auth 401 responses.
- **File**: `admin-dashboard/src/api/client.js:29-32`
- **Detail**:
  ```javascript
  if (error.response?.status === 401) {
    storage?.removeItem('adminToken');
    storage?.removeItem('adminUser');
    window.location.href = '/login';
  }
  ```
- **TODO**: Only logout on 401 from protected endpoints, not from auth endpoints.

### Bugs

#### BUG-7: Unhandled Promises in Event Logging
- **Risk**: If unhandled rejection occurs, Node.js will crash (deprecated behavior) or silently fail.
- **File**: `api/controllers/shelvesController.js:334-346`
- **Detail**: `logShelfEvent()` is async but called without `await` in some places (fire-and-forget):
  ```javascript
  logShelfEvent({...});  // No await, no .catch()
  ```
- **TODO**: Either `await logShelfEvent(...)` or add `.catch(err => console.error(...))` at every call site.

#### BUG-8: parseInt Without NaN Validation on Route Params
- **Risk**: `parseInt("abc", 10)` returns NaN. Query `WHERE id = NaN` matches nothing silently. User gets 404 instead of 400 Bad Request.
- **Files**:
  - `api/routes/collectables.js:304`
  - Multiple other route files
- **TODO**:
  - Add shared `parseIntId(value)` utility that throws on NaN/negative/non-finite values.
  - Return 400 Bad Request for invalid IDs instead of silently returning no results.

#### BUG-9: Missing Transaction Rollback in Vision Pipeline
- **Risk**: Partial writes — orphaned event/aggregate records if later steps fail.
- **Files**: `api/services/visionPipeline.js`, `api/database/queries/shelves.js`
- **Detail**: Vision pipeline creates events, aggregates, and shelf items across multiple separate DB operations. If one fails mid-way, previous writes persist.
- **TODO**: Wrap multi-step DB operations in transactions with rollback on failure.

#### BUG-10: State Updates After Unmount in Mobile Screens
- **Risk**: React warnings, potential crashes, memory leaks.
- **Files**:
  - `mobile/src/screens/SocialFeedScreen.js:213-244` — `load()` doesn't check mounted state before `setEntries()`, `setRefreshing()`
  - `mobile/src/screens/ProfileScreen.js:70-99` — Multiple setState calls without isMounted guard. `loadProfile`, `loadPosts`, `loadFavorites`, `loadLists` all vulnerable
  - `mobile/src/screens/ShelfDetailScreen.js:115-157` — Same pattern
  - `mobile/src/context/PushContext.js:143-149` — `getLastNotificationResponse()` with `setTimeout(500)` can fire after unmount
  - `mobile/src/context/ThemeContext.js:48-61` — `AsyncStorage.getItem()` result set without mount check
- **Note**: `FeedDetailScreen.js:52-73` correctly uses `isMounted` flag — use as reference pattern.
- **TODO**: Add `isMounted` ref pattern (or AbortController) to all screens with async data loading.

#### BUG-11: Optimistic Like Updates Revert to Stale State
- **Risk**: If multiple likes happen in sequence and one fails, the revert uses stale previous state instead of actual state.
- **File**: `mobile/src/screens/SocialFeedScreen.js:416-440`
- **Detail**: `handleToggleLike` optimistically updates state, but on error reverts to the captured previous state. If multiple rapid interactions occur, the reverted state may not reflect reality.
- **Note**: `FeedDetailScreen.js:99-116` has a better pattern — stores previous values separately.
- **TODO**: Store actual previous values at point of optimistic update. Consider using a queue for rapid interactions.

#### BUG-12: Pagination loadMore Has No Debounce
- **Risk**: Rapid scroll triggers duplicate fetches, causing duplicate items in the list.
- **File**: `mobile/src/screens/ShelfDetailScreen.js:160`
- **Detail**: `loadMore` depends on `items.length` but has no debouncing or "loading more" guard.
- **TODO**: Add `isLoadingMore` state flag. Skip `loadMore` if already in progress.

#### BUG-13: Admin Modal Error State Not Cleared Between Actions
- **Risk**: Old error message persists after a successful action.
- **File**: `admin-dashboard/src/components/UserDetailModal.jsx:18-29`
- **Detail**: `setError(null)` is called in `loadUser()` (line 21) but NOT in action handlers (suspend, unsuspend, toggle admin). If a previous error exists and the next action succeeds, the old error remains visible.
- **TODO**: Clear error state at the start of each action handler.

#### BUG-14: Race Condition in Admin Filter Updates
- **Risk**: `loadUsers` may execute with stale filter state.
- **File**: `admin-dashboard/src/pages/Users.jsx:49-52`
- **Detail**:
  ```javascript
  function handleFilterChange(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }
  ```
  `setFilters` and `setPage` are separate state updates. The useEffect that calls `loadUsers` (line 37) might fire between them with the old page value or old filters.
- **TODO**: Combine filters and page into a single state object, or use `useReducer`.

#### BUG-15: Discover Pagination Missing Offset for category=all & item_type=all
- **Risk**: Inconsistent paging — duplicate or unstable page traversal.
- **File**: `api/controllers/discoverController.js:95`
- **TODO**: Apply deterministic cross-group paging strategy (global row number or grouped window + offset).

### Tech Debt

#### DEBT-4: Magic Numbers and Config Scattered Across 10+ Files
- **Risk**: Hard to locate all configuration options. Inconsistent naming.
- **Files**:
  - `api/controllers/shelvesController.js:234-246` — `DEFAULT_OCR_CONFIDENCE_THRESHOLD = 0.7`
  - `api/middleware/auth.js:4-5` — `AUTH_CACHE_TTL_MS`, `AUTH_CACHE_MAX_ENTRIES`
  - `api/database/queries/feed.js:4-5` — `AGGREGATE_WINDOW_MINUTES`, `PREVIEW_PAYLOAD_LIMIT`
  - `mobile/src/App.js:62-63, 101-102` — hardcoded token keys, ports, emulator IPs
  - `mobile/src/screens/SocialFeedScreen.js:30-34, 188` — filter defs, rate limit
  - `mobile/src/screens/ShelfDetailScreen.js:28, 38-45, 120` — camera quality, sort options, page size
  - `mobile/src/hooks/useVisionProcessing.js:5` — `POLL_INTERVAL_MS = 2000`
  - `admin-dashboard/vite.config.js:10` — hardcoded API port 5001
  - `admin-dashboard/src/pages/Settings.jsx:45` — hardcoded version `1.0.0`
- **TODO**: Create `api/config/index.js` centralizing all API config. Create `mobile/src/config.js` for mobile constants. Use env vars with documented defaults.

#### DEBT-5: Inconsistent Error Handling Across API
- **Risk**: Operational blind spots. No error tracking integration.
- **Files**: All controllers and routes
- **Detail**: Some routes log errors verbosely, some silently swallow them, event logging errors are only `console.warn`. No structured error format. No Sentry/DataDog integration.
- **TODO**:
  - Create `api/utils/errorHandler.js` with structured JSON logging.
  - Standardize error response format across all routes.
  - Add error tracking service integration.

#### DEBT-6: Console.log Statements in Production Mobile Code
- **Risk**: Debug info leaked in production. Performance overhead.
- **Files**:
  - `mobile/src/App.js:86` — logs ngrok config
  - `mobile/src/context/PushContext.js:65, 80, 128, 134` — logs push token info, notifications
  - `mobile/src/screens/CheckInScreen.js:91` — logs search errors
- **TODO**: Remove console.log/warn statements or gate behind `__DEV__` check.

#### DEBT-7: SocialFeedScreen Is 1,959 Lines
- **Risk**: Difficult to maintain, test, or review. High cognitive load.
- **File**: `mobile/src/screens/SocialFeedScreen.js`
- **Detail**: Contains rendering, search, likes/comments, news items, all styling in a single file.
- **TODO**: Split into sub-components: `FeedSearch`, `FeedEntry`, `FeedNewsItem`, `FeedCoverRow`, etc.

#### DEBT-8: Missing Error Boundary in Mobile App
- **Risk**: Any screen crash takes down the entire app. No graceful recovery.
- **Files**: No ErrorBoundary component found anywhere in `mobile/src/`.
- **TODO**: Add React Error Boundary wrapping the navigation stack. Show fallback UI on crash.

#### DEBT-9: RLS Policy Migrations Exist but Runtime Queries Don't Use User Context
- **Risk**: Drift between intended DB isolation model and runtime behavior.
- **Files**:
  - `api/database/pg.js:140`
  - `api/database/pg.js:165`
- **TODO**:
  - Decide one strategy: adopt `queryWithContext`/`transactionWithContext` across query modules, OR disable RLS policies until full migration.

#### DEBT-10: Vision Route Middleware Requires imageBase64 Even Though Controller Supports rawItems
- **Risk**: MLKit-style `rawItems` requests cannot use `/api/shelves/:shelfId/vision` directly.
- **File**: `api/routes/shelves.js:45`
- **TODO**: Align route validation with controller contract (`imageBase64` OR `rawItems`).

### Duplicate Code

#### DUP-1: String Normalization Functions Duplicated in 3+ API Files
- **Files**:
  - `api/controllers/shelvesController.js:66-111` — `normalizeString()`, `normalizeStringArray()`, `normalizeTags()`
  - `api/routes/collectables.js:66-70` — same functions
  - `api/controllers/profileController.js:15-17` — same pattern
- **TODO**: Extract to `api/utils/normalize.js`. Import everywhere.

#### DUP-2: Pagination Parameter Parsing Duplicated
- **Files**: Multiple controllers duplicate limit/offset parsing. `api/database/queries/utils.js` has `parsePagination()` but it's not used consistently.
- **TODO**: Use `parsePagination` from utils consistently. Enforce max limits uniformly.

#### DUP-3: Ownership Verification Repeated Per Query Module
- **Files**:
  - `api/database/queries/shelves.js:26` — `getById(shelfId, userId)`
  - `api/database/queries/wishlists.js` — identical pattern
  - `api/database/queries/lists.js` — identical pattern
  - `api/database/queries/needsReview.js` — identical pattern
- **Detail**: Each module implements `WHERE id = $1 AND owner_id = $2` independently.
- **TODO**: Consider shared ownership verification helper in `api/database/queries/auth-helpers.js`.

#### DUP-4: Cover URL Resolution Duplicated Across Mobile Screens
- **Files**:
  - `mobile/src/screens/SocialFeedScreen.js:67-117` — `resolveCollectableCoverUrl()` and `resolveManualCoverUrl()`
  - `mobile/src/screens/CollectableDetailScreen.js` — same logic
  - `mobile/src/screens/ShelfDetailScreen.js` — same pattern
- **TODO**: Create shared `mobile/src/utils/coverUrl.js` utility. Import in all screens.

#### DUP-5: Loading State Pattern (useState + useEffect + try/catch/finally)
- **Files**: Repeated in 5+ screens:
  - `mobile/src/screens/AccountScreen.js:25-48`
  - `mobile/src/screens/ProfileScreen.js:31-100`
  - `mobile/src/screens/ShelfDetailScreen.js:115-157`
  - `mobile/src/screens/FavoritesScreen.js:43-76`
  - `mobile/src/screens/FeedDetailScreen.js:52-73`
- **TODO**: Create reusable `useAsync(asyncFn, deps)` hook that returns `{ data, loading, error, refresh }`.

#### DUP-6: Search State Pattern Duplicated
- **Files**:
  - `mobile/src/screens/SocialFeedScreen.js:168-172`
  - `mobile/src/screens/CheckInScreen.js:56-59`
  - `mobile/src/screens/WishlistScreen.js:47-56`
- **Detail**: Same useState pattern: `searchQuery`, `searchResults`, `searchLoading`, `searchTimeoutRef`.
- **TODO**: Create `useSearch(searchFn, debounceMs)` hook.

#### DUP-7: Admin Pagination Controls Duplicated for Breakpoints
- **File**: `admin-dashboard/src/pages/Users.jsx:113-157`
- **Detail**: Nearly identical pagination buttons for mobile and desktop responsive views.
- **TODO**: Extract shared `<Pagination>` component.

#### DUP-8: Admin User Avatar and Status Badges Duplicated
- **Files**:
  - `admin-dashboard/src/components/UserDetailModal.jsx:99-111, 121-141`
  - `admin-dashboard/src/components/UserTable.jsx:49-62, 79-99`
- **Detail**: Identical avatar rendering (image or placeholder with initial) and badge rendering (suspended/active/admin/premium).
- **TODO**: Extract `<UserAvatar>` and `<UserBadge>` shared components.

---

## Low Priority / Enhancement

### Duplicate Code (Low)

#### DUP-9: API Error Extraction Pattern Repeated 7+ Times in Admin
- **Files**: `Dashboard.jsx:24-25`, `Users.jsx:32-33`, `UserDetailModal.jsx:24-25, 39-40, 52-53, 68-69`
- **Pattern**: `catch (err) { setError(err.response?.data?.error || 'Generic message') }`
- **TODO**: Create `getErrorMessage(err)` utility.

#### DUP-10: Media URL Resolution Used Inconsistently
- **Files**: `api/services/mediaUrl.js` exists with `resolveMediaUrl()` but some controllers build URLs manually.
- **TODO**: Enforce use of `resolveMediaUrl()` everywhere.

#### DUP-11: Console.warn + Conditional Alert Pattern in Mobile
- **Files**: `FavoritesScreen.js:70`, `ProfileScreen.js:99`, `ShelfDetailScreen.js:149`
- **TODO**: Create shared error handler that logs and optionally shows toast.

#### DUP-12: Navigation Dismiss + Clear Search Pattern
- **Files**: `SocialFeedScreen.js:370-386`, `CheckInScreen.js`, multiple others
- **TODO**: Create shared `dismissSearchAndNavigate()` utility.

### Tech Debt (Low)

#### DEBT-11: MongoDB Memory Server in Root package.json
- **File**: `package.json:14`
- **Detail**: `"mongodb-memory-server": "^10.2.1"` — app uses PostgreSQL, not MongoDB.
- **TODO**: Remove unused dependency.

#### DEBT-12: Root package.json Test Dependencies Misplaced
- **File**: `package.json:10-19`
- **Detail**: `jest`, `supertest` installed at root but tests live in `api/`.
- **TODO**: Move to `api/package.json` devDependencies or remove from root.

#### DEBT-13: Missing Convenience Scripts at Root
- **File**: `package.json:6-9`
- **Detail**: Only `server` and `start` scripts. No `setup`, `dev:all`, `migrate` convenience scripts.
- **TODO**: Add monorepo convenience scripts.

#### DEBT-14: Hardcoded UI Strings in Admin (No i18n)
- **Files**: All admin dashboard pages and components.
- **TODO**: Low priority unless internationalization is needed.

#### DEBT-15: Empty Icon Container in StatsCard
- **File**: `admin-dashboard/src/components/StatsCard.jsx:16`
- **Detail**: `<div className="h-6 w-6 text-white" />` — no icon content.
- **TODO**: Add icons from heroicons or lucide-react.

#### DEBT-16: No Audit Log Viewer in Admin Dashboard
- **Detail**: Admin actions are not viewable in the UI. Cannot investigate "who changed what and when."
- **TODO**: Add `/admin/audit-log` endpoint + dashboard page.

### Bugs (Low)

#### BUG-16: FavoritesScreen Has No Pagination
- **Risk**: Loads all favorites at once. Will fail for users with large collections.
- **File**: `mobile/src/screens/FavoritesScreen.js:43-76`
- **TODO**: Add pagination/infinite scroll.

#### BUG-17: ProfileScreen Loads 4 Data Types in Parallel With No Granular Loading States
- **Risk**: User sees blank screen while data loads. If one request fails, no indication which.
- **File**: `mobile/src/screens/ProfileScreen.js:90-99`
- **TODO**: Add per-section loading indicators.

#### BUG-18: entry.items Assumed to Be Array in Feed Dismiss Handler
- **Risk**: Could crash if `entry.items` is undefined or null.
- **File**: `mobile/src/screens/SocialFeedScreen.js:255`
- **TODO**: Add null check: `(entry.items || []).filter(...)`.

#### BUG-19: Memory Leak in SocialFeedScreen searchTimeoutRef
- **Risk**: Timeout can fire after navigation away from screen.
- **File**: `mobile/src/screens/SocialFeedScreen.js:337-367`
- **Detail**: `searchTimeoutRef` is cleared on unmount but can fire during navigation transition.
- **TODO**: Clear timeout in navigation blur listener, not just unmount.

#### BUG-20: useVisionProcessing Polling Can setState After Unmount
- **Risk**: React state update warning, potential crash.
- **File**: `mobile/src/hooks/useVisionProcessing.js:70-95`
- **Detail**: `setInterval` polling doesn't check if component is mounted before state updates.
- **TODO**: Add isMounted check inside polling callback.

#### BUG-21: CheckInScreen Navigation Calls Both goBack and navigate
- **Risk**: Unexpected navigation stack state.
- **File**: `mobile/src/screens/CheckInScreen.js:141-146`
- **TODO**: Use only one navigation action.

### Security (Low)

#### SEC-22: No Certificate Pinning in Mobile
- **Risk**: MITM attacks possible on compromised networks (low likelihood with TLS).
- **File**: `mobile/src/services/api.js:42`
- **TODO**: Consider adding certificate pinning for production.

#### SEC-23: Missing Admin Action Audit Trail in Dashboard
- **Risk**: Cannot track who performed admin actions or when.
- **Files**: `admin-dashboard/src/components/UserDetailModal.jsx:31-72`
- **Detail**: API has `admin_action_logs` table (per `AGENTS/admin-system.md`) but no viewer in the dashboard.
- **TODO**: Add audit log page to admin dashboard.

#### SEC-24: No Admin Action Rate Limiting on Frontend
- **Risk**: Admin can perform unlimited suspend/unsuspend/toggle actions rapidly.
- **File**: `admin-dashboard/src/components/UserDetailModal.jsx:31-72`
- **TODO**: Add client-side debounce and/or server-side per-admin rate limits on state-changing actions.

---

## Missing Mobile Dependencies/Patterns (Noted)

- **No TypeScript**: Entire mobile codebase is plain JavaScript. Prone to runtime type errors.
- **No Request Cancellation**: No AbortController usage for API calls on unmount.
- **No Image Lazy Loading**: ShelfDetailScreen loads all item images eagerly.
- **Sort Options Duplicated**: `ShelfDetailScreen.js:38-45` and `WishlistScreen.js:29-34` have identical sort option arrays.

---

## Code Duplication Statistics
- Previous jscpd audit reported ~2.98% duplicated tokens.
- Manual analysis identified 12 distinct duplication patterns across all three codebases.
- Most impactful: normalization functions (API), cover URL resolution (mobile), loading state pattern (mobile).
