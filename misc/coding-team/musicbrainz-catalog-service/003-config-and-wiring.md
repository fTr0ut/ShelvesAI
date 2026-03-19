# Task 003: Config and Wiring

## Context

`MusicCatalogService`, `MusicBrainzAdapter`, and the adapter transformer are implemented. The adapter barrel (`adapters/index.js`) and `shelfType.json` were already updated in Task 002. What remains is wiring the service into the runtime: `apiContainers.json`, `CatalogRouter`, `visionPipeline.js`, and `collectableMatchingService.js`.

## Objective

Wire the MusicBrainz catalog service into the system so vinyl shelves get catalog lookups during vision search and manual matching.

## Scope

### 1. `api/config/apiContainers.json`

Replace the disabled `discogs` entry in the `vinyl` container with an enabled `musicbrainz` entry:

```json
"vinyl": {
    "mode": "fallback",
    "apis": [
        {
            "name": "musicbrainz",
            "enabled": true,
            "priority": 1,
            "envDisableKey": "DISABLE_MUSICBRAINZ"
        }
    ]
}
```

### 2. `api/services/catalog/CatalogRouter.js`

In the constructor's `_adapterFactories` map (around line 49-56), replace the `discogs` entry with `musicbrainz`:

```js
musicbrainz: () => this._loadAdapter('MusicBrainzAdapter'),
```

Remove the `discogs` entry.

### 3. `api/services/visionPipeline.js`

**Import** (add after line 27):
```js
const { MusicCatalogService } = require('./catalog/MusicCatalogService');
```

**Catalogs map** (around line 157-162): Add `music` entry and remove the placeholder comment:
```js
this.catalogs = options.catalogs || {
    book: new BookCatalogService(),
    game: new GameCatalogService(),
    movie: new MovieCatalogService(),
    music: new MusicCatalogService(),
};
```

The key is `music` (not `vinyl`) because `resolveCatalogServiceForShelf()` iterates all catalogs and calls `service.supportsShelfType(shelfType)` — the `MusicCatalogService.supportsShelfType('vinyl')` will return true because it delegates to `shelfTypeResolver.supportsShelfType(type, 'vinyl')`.

### 4. `api/services/collectableMatchingService.js`

**Import** (add after line 15):
```js
const { MusicCatalogService } = require('./catalog/MusicCatalogService');
```

**Constructor** (around line 96-106): Add music catalog service:
```js
this.musicCatalogService = new MusicCatalogService();
this.catalogServices = [
    this.gameCatalogService,
    this.movieCatalogService,
    this.bookCatalogService,
    this.musicCatalogService,
];
```

## Non-goals

- No changes to the mobile app
- No changes to the admin dashboard
- No new routes or controllers

## Constraints

- Do NOT change the `resolveCatalogServiceForShelf()` logic in visionPipeline.js — it already iterates `this.catalogs` and calls `supportsShelfType()`, which will pick up the new music service automatically.
- Do NOT change the `resolveCatalogService()` logic in collectableMatchingService.js — same iteration pattern.
