# Task 005: DependencyTree.md Update

## Context

The DependencyTree was partially updated in Task 002 (new files added), but the wiring changes from Task 003 are not reflected. Additionally, the `MusicBrainzRequestQueue` needs its own entry, and the External Service Integrations table needs a MusicBrainz row.

## Objective

Complete the DependencyTree.md updates to reflect all changes from this feature.

## Scope

### 1. `visionPipeline.js` section (around line 438)

Add `→ services/catalog/MusicCatalogService.js` to the dependency list. It should appear after the other catalog services. The section should look like:

```
services/visionPipeline.js
  → services/googleGemini.js
  → services/processingStatus.js
  → services/visionPipelineHooks.js
  → services/collectables/fingerprint.js
  → services/collectables/kind.js
  → services/catalog/BookCatalogService.js
  → services/catalog/MovieCatalogService.js
  → services/catalog/GameCatalogService.js
  → services/catalog/TvCatalogService.js
  → services/catalog/MusicCatalogService.js
  → services/manuals/otherManual.js
  → database/pg.js
  → database/queries/collectables.js
  → database/queries/shelves.js
  → database/queries/needsReview.js
  → database/queries/feed.js
  → config/constants.js
  → config/visionSettings.json
```

### 2. `collectableMatchingService.js` section (around line 469)

Add `→ services/catalog/MusicCatalogService.js` to the dependency list:

```
services/collectableMatchingService.js
  → database/queries/collectables.js
  → services/collectables/fingerprint.js
  → services/catalog/BookCatalogService.js
  → services/catalog/MovieCatalogService.js
  → services/catalog/GameCatalogService.js
  → services/catalog/TvCatalogService.js
  → services/catalog/MusicCatalogService.js
```

### 3. Add `MusicBrainzRequestQueue.js` entry

After the `MusicCatalogService.js` entry (around line 509), add:

```
services/catalog/MusicBrainzRequestQueue.js
  (no internal imports — FIFO request queue)
```

### 4. External Service Integrations table

Add a MusicBrainz row to the table (around line 1160-1165 area). It should be:

```
| **MusicBrainz** | `node-fetch` | `services/catalog/MusicCatalogService.js`, `adapters/musicbrainz.adapter.js` | (public API, no key) |
```

Also add a Cover Art Archive row:

```
| **Cover Art Archive** | `node-fetch` | `adapters/musicbrainz.adapter.js` | (public API, no key) |
```

## Non-goals

- No code changes, only documentation.

## Constraints

- Preserve the existing formatting and style of DependencyTree.md exactly.
- The "Last updated" date at the top should be updated to today's date.
