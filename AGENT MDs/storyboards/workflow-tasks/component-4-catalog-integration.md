# Component 4: Catalog Service Integration

## Objective
Integrate catalog API lookups into the vision pipeline, leveraging existing `BookCatalogService`, `GameCatalogService`, and `MovieCatalogService`.

## Context

The following catalog services already exist in `api/services/catalog/`:
- `BookCatalogService.js` → OpenLibrary API
- `GameCatalogService.js` → IGDB API
- `MovieCatalogService.js` → TMDB API

The `resolveCatalogServiceForShelf(type)` helper in `shelvesController.js` already maps shelf types to services.

---

## Implementation in VisionPipelineService

### `lookupCatalog(items, shelfType)`

```javascript
async lookupCatalog(items, shelfType) {
  const catalogService = this.resolveCatalogService(shelfType);
  
  if (!catalogService) {
    // No catalog service for this shelf type
    return { resolved: [], unresolved: items };
  }

  const results = await catalogService.lookupFirstPass(items);
  
  // Separate resolved vs unresolved
  const resolved = results.filter(r => r.catalogMatch);
  const unresolved = results.filter(r => !r.catalogMatch);
  
  return { resolved, unresolved };
}

resolveCatalogService(shelfType) {
  const normalized = String(shelfType || '').toLowerCase();
  
  if (['book', 'books', 'novel', 'comic', 'manga'].includes(normalized)) {
    return new BookCatalogService();
  }
  if (['game', 'games', 'video game'].includes(normalized)) {
    return new GameCatalogService();
  }
  if (['movie', 'movies', 'film', 'blu-ray', 'dvd'].includes(normalized)) {
    return new MovieCatalogService();
  }
  return null;
}
```

---

## Catalog Service Interface

Each catalog service implements:

```typescript
interface CatalogService {
  supportsShelfType(type: string): boolean;
  lookupFirstPass(items: MinimalItem[]): Promise<CatalogResult[]>;
  safeLookup(item: MinimalItem): Promise<CatalogMatch | null>;
}
```

**CatalogResult:**
```typescript
interface CatalogResult {
  originalItem: MinimalItem;
  catalogMatch: CollectableSchema | null;
  confidence: number;
  source: 'openlibrary' | 'igdb' | 'tmdb';
}
```

---

## Rate Limiting

Existing services already handle rate limiting:
- `GameCatalogService` has `_withRateLimit()` and exponential backoff
- `BookCatalogService.safeLookup()` has 429 retry logic

The pipeline should process items sequentially to respect rate limits:
```javascript
async lookupCatalog(items, shelfType) {
  const resolved = [];
  const unresolved = [];
  
  for (const item of items) {
    const match = await catalogService.safeLookup(item);
    if (match) {
      resolved.push({ ...item, ...match, confidence: 0.95, source: 'catalog' });
    } else {
      unresolved.push(item);
    }
  }
  
  return { resolved, unresolved };
}
```

---

## Testing

```bash
npm test -- visionPipeline -- --grep "catalog"
```

**Test cases (with mocks):**
1. Book lookup returns OpenLibrary data
2. Game lookup returns IGDB data with cover art
3. Movie lookup returns TMDB data
4. Unresolved items passed to enrichment step
5. Rate limit handling doesn't crash pipeline

---

## Acceptance Criteria
- [ ] `lookupCatalog()` uses appropriate catalog service per shelf type
- [ ] Resolved items have `source: 'catalog'` and high confidence
- [ ] Unresolved items are collected for Gemini enrichment
- [ ] Rate limits are respected (sequential processing)
- [ ] Missing catalog service gracefully returns all items as unresolved
