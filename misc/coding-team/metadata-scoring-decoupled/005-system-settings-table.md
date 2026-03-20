# Task 005: system_settings Table + Query File + Cached Reader

## Context

We need a general-purpose, database-backed settings system so admins can update configuration (like metadata scoring criteria) OTA without redeploying. This is the foundation — the admin endpoints come in Task 006.

## Objective

1. Create a `system_settings` table via Knex migration.
2. Create `api/database/queries/systemSettings.js` — CRUD query functions.
3. Create `api/services/config/SystemSettingsCache.js` — a cached reader with TTL that avoids hitting the DB on every scoring call.
4. Wire `MetadataScorer` to check the DB override before falling back to the static JSON config.

## Scope

### 1. Migration file

**Filename:** `api/database/migrations/20260319010000_create_system_settings.js`

```sql
CREATE TABLE system_settings (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- `key` is the primary key (e.g., `metadata_score_config`).
- `value` is JSONB — stores the full config object.
- `description` is optional human-readable text.
- `updated_by` tracks which admin last modified it.

### 2. `api/database/queries/systemSettings.js`

Follow the pattern in `notificationPreferences.js`. Functions:

- `getSetting(key)` → `{ key, value, description, updatedBy, createdAt, updatedAt }` or `null`
- `upsertSetting(key, value, { description, updatedBy })` → the upserted row
  - INSERT ON CONFLICT (key) DO UPDATE SET value, description, updated_by, updated_at
- `deleteSetting(key)` → `boolean` (true if deleted)
- `getAllSettings()` → array of all settings rows

All functions use `const { query } = require('../pg')` and `rowToCamelCase` from `./utils`.

### 3. `api/services/config/SystemSettingsCache.js`

A simple in-memory cache with TTL for system settings. Avoids hitting the DB on every `MetadataScorer.score()` call.

```js
class SystemSettingsCache {
  constructor(options = {}) {
    this._cache = new Map();  // key → { value, expiresAt }
    this._ttlMs = options.ttlMs ?? 60000;  // default 1 minute
    this._queryFn = options.queryFn ?? null;  // injected for testing
  }

  async get(key) {
    const cached = this._cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }
    // Cache miss or expired — fetch from DB
    const getFn = this._queryFn || require('../../database/queries/systemSettings').getSetting;
    const row = await getFn(key);
    const value = row?.value ?? null;
    this._cache.set(key, { value, expiresAt: Date.now() + this._ttlMs });
    return value;
  }

  invalidate(key) {
    if (key) {
      this._cache.delete(key);
    } else {
      this._cache.clear();
    }
  }
}
```

Singleton via `getSystemSettingsCache()`.

### 4. Wire `MetadataScorer` to use DB override

Update `MetadataScorer` to accept an optional `settingsCache` in the constructor. Add a new async method:

- `async scoreAsync(collectable, containerType)` — same as `score()` but first checks `settingsCache.get('metadata_score_config')` for a DB override. If found, uses that config for the container type. Falls back to the static file config.

The existing synchronous `score()` method stays unchanged (it uses the static config only). This is important because `CatalogRouter._lookupFallback()` is already async, so it can call `scoreAsync()`.

Update `CatalogRouter._lookupFallback()` to call `scorer.scoreAsync(result, containerType)` instead of `scorer.score(result, containerType)`. The `getMetadataScorer()` singleton should be constructed with the `getSystemSettingsCache()` singleton.

## Non-goals

- No admin endpoints yet (Task 006).
- No seeding of default settings into the table.
- No migration of existing env-var overrides into the table.

## Constraints

- CommonJS modules.
- The `SystemSettingsCache` must be testable with an injected `queryFn` to avoid real DB calls in tests.
- The TTL default of 60 seconds means config changes take up to 1 minute to propagate. This is acceptable for scoring criteria updates.
- The `score()` synchronous method must continue to work without a DB connection (for tests and offline scenarios).
