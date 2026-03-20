# Task 008: DependencyTree Update

## Context

Multiple files were created and modified across Tasks 001-007 of the metadata scoring decoupling feature. The DependencyTree was partially updated during some tasks but needs a comprehensive pass to ensure all new files, imports, and config changes are reflected.

## Objective

Update `AGENTS/DependencyTree.md` to reflect all changes from this feature.

## Scope

Read the current `AGENTS/DependencyTree.md` and make the following updates:

### 1. `metadataScore.js` entry (around line 533)

Currently says `(no internal imports)`. Update to:
```
services/catalog/metadataScore.js
  → services/catalog/MetadataScorer.js
```

### 2. Add `CoverArtBackfillHook.js` entry

After the `MusicBrainzRequestQueue.js` entry, add:
```
services/catalog/CoverArtBackfillHook.js
  → services/visionPipelineHooks.js (lazy require in register())
```

### 3. Add `database/queries/systemSettings.js` entry

In the database queries section, add:
```
database/queries/systemSettings.js
  → database/pg.js
  → database/queries/utils.js
```

### 4. Update `controllers/adminController.js` entry

Find the adminController entry and add the new imports:
```
controllers/adminController.js
  → database/queries/admin.js
  → database/queries/systemSettings.js
  → services/config/SystemSettingsCache.js
```

### 5. Update `routes/admin.js` entry

Ensure it references `controllers/adminController.js` (it likely already does).

### 6. Add `scripts/backfillMetascore.js` entry

In a scripts section (create if needed), add:
```
scripts/backfillMetascore.js
  → database/pg.js
  → services/catalog/MetadataScorer.js
  → services/config/shelfTypeResolver.js
  → database/queries/utils.js
```

### 7. Add `database/queries/admin.js` update

If the admin.js query entry exists, ensure it shows `→ database/pg.js` (for the new standalone `logAction` export).

### 8. Migration entries

Add to the migrations table:
- `20260319000000_add_collectables_metascore.js` — Adds `metascore` JSONB column to collectables
- `20260319010000_create_system_settings.js` — Creates `system_settings` table

### 9. Config files section

Add `config/metadataScoreConfig.json` to the config files listing if not already present.

### 10. Update the "Last updated" date to today (2026-03-19).

## Non-goals

- No code changes.

## Constraints

- Preserve existing formatting exactly.
- Only add/update entries — do not remove any existing entries.
