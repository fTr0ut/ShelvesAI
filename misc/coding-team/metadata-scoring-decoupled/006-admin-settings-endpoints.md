# Task 006: Admin Settings Endpoints

## Context

The `system_settings` table and query file exist (Task 005). We need admin API endpoints to read and write settings, and to invalidate the `SystemSettingsCache` on writes so changes propagate immediately.

## Objective

Add admin endpoints for system settings management. Wire cache invalidation on writes.

## Scope

### 1. Add controller functions to `api/controllers/adminController.js`

Add three new functions at the bottom of the file:

**`getSettings(req, res)`** — `GET /api/admin/settings`
- Calls `systemSettingsQueries.getAllSettings()`
- Returns `{ settings: [...] }`

**`getSetting(req, res)`** — `GET /api/admin/settings/:key`
- Calls `systemSettingsQueries.getSetting(req.params.key)`
- Returns `{ setting: { ... } }` or 404 `{ error: 'Setting not found' }`

**`updateSetting(req, res)`** — `PUT /api/admin/settings/:key`
- Validates: `req.body.value` must be present (can be any JSON type)
- Calls `systemSettingsQueries.upsertSetting(key, value, { description, updatedBy: req.user.id })`
- Invalidates `SystemSettingsCache` for that key: `getSystemSettingsCache().invalidate(key)`
- Logs admin action via `adminQueries.logAction(...)` (same pattern as suspend/unsuspend)
- Returns `{ setting: { ... } }`

Import at the top of adminController.js:
```js
const systemSettingsQueries = require('../database/queries/systemSettings');
const { getSystemSettingsCache } = require('../services/config/SystemSettingsCache');
```

### 2. Add routes to `api/routes/admin.js`

Add after the existing routes, before `module.exports`:

```js
// System settings (read routes before CSRF middleware, write routes after)
```

Actually — looking at the route file structure, the CSRF middleware is applied via `router.use(requireAdminCsrf)` at line 51, and all routes after that require CSRF. The GET routes should go BEFORE the CSRF middleware (reads don't need CSRF), and the PUT route should go AFTER it.

Add before the `router.use(requireAdminCsrf)` line:
```js
// System settings (read)
router.get('/settings', adminController.getSettings);
router.get('/settings/:key', adminController.getSetting);
```

Add after the CSRF middleware (after the existing state-changing routes):
```js
// System settings (write)
router.put('/settings/:key', adminController.updateSetting);
```

### 3. Admin action logging

Use the existing `adminQueries.logAction()` pattern for the PUT endpoint:
```js
await adminQueries.logAction({
  adminId: req.user.id,
  action: 'update_setting',
  targetUserId: null,
  metadata: { key, previousValue: existing?.value ?? null },
  ...getAdminContext(req),
});
```

## Non-goals

- No DELETE endpoint (settings should be updated, not deleted, to avoid accidental removal).
- No admin dashboard UI changes.
- No validation of the setting value structure (the admin is trusted to send valid JSON).

## Constraints

- Follow the exact patterns in `adminController.js` (try/catch, error logging, response shapes).
- The `getAdminContext(req)` helper is already defined in adminController.js — use it.
- Cache invalidation must happen AFTER the DB write succeeds, not before.
