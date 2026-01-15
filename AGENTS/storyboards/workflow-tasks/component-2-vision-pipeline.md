# Component 2: Vision Pipeline Service

## Objective
Create a centralized orchestrator that handles the complete vision workflow from image upload to database storage.

## New File

### `api/services/visionPipeline.js`

```javascript
const { GoogleCloudVisionService } = require('./googleCloudVision');
const { GoogleGeminiService } = require('./googleGemini');
const collectablesQueries = require('../database/queries/collectables');
const needsReviewQueries = require('../database/queries/needsReview');
const shelvesQueries = require('../database/queries/shelves');
const { makeLightweightFingerprint } = require('./collectables/fingerprint');

// Configurable threshold (default 90%)
const AUTO_ADD_THRESHOLD = parseFloat(process.env.VISION_AUTO_ADD_THRESHOLD || '0.9');

class VisionPipelineService {
  constructor() {
    this.visionService = new GoogleCloudVisionService();
    this.geminiService = new GoogleGeminiService();
  }

  /**
   * Main entry point: process image and return results
   */
  async processImage(imageBase64, shelf, userId) {
    // Step 1: Extract items from image
    const rawItems = await this.extractItems(imageBase64, shelf.type);
    
    // Step 2: Lookup in catalog API
    const catalogResults = await this.lookupCatalog(rawItems, shelf.type);
    
    // Step 3: Enrich unresolved with Gemini
    const enriched = await this.enrichUnresolved(catalogResults.unresolved, shelf.type);
    
    // Step 4: Combine and categorize by confidence
    const allItems = [...catalogResults.resolved, ...enriched];
    const { autoAdd, needsReview } = this.categorizeByConfidence(allItems);
    
    // Step 5: Process auto-add items
    const addedItems = await this.saveToShelf(autoAdd, userId, shelf.id);
    
    // Step 6: Save needs-review items
    await this.saveToReviewQueue(needsReview, userId, shelf.id);
    
    return {
      analysis: { shelfConfirmed: true, items: allItems },
      results: { added: addedItems.length, needsReview: needsReview.length },
      addedItems,
      needsReview
    };
  }

  async extractItems(imageBase64, shelfType) { /* ... */ }
  async lookupCatalog(items, shelfType) { /* ... */ }
  async enrichUnresolved(items, shelfType) { /* ... */ }
  categorizeByConfidence(items) { /* ... */ }
  async matchCollectable(item) { /* ... */ }
  async saveToShelf(items, userId, shelfId) { /* ... */ }
  async saveToReviewQueue(items, userId, shelfId) { /* ... */ }
}

module.exports = { VisionPipelineService };
```

---

## Method Specifications

### `extractItems(imageBase64, shelfType)`
1. Call `visionService.detectShelfItems()`
2. Call `visionService.parseToItems()` to get {title, author} array
3. Return minimal item list

### `lookupCatalog(items, shelfType)`
1. Get catalog service via `resolveCatalogServiceForShelf(shelfType)`
2. Call `catalogService.lookupFirstPass(items)`
3. Return `{ resolved: [...], unresolved: [...] }`

### `enrichUnresolved(items, shelfType)`
1. Call `geminiService.enrichWithSchema(items, shelfType)`
2. Return enriched items with confidence scores

### `categorizeByConfidence(items)`
```javascript
const autoAdd = items.filter(i => i.confidence >= AUTO_ADD_THRESHOLD);
const needsReview = items.filter(i => i.confidence < AUTO_ADD_THRESHOLD);
return { autoAdd, needsReview };
```

### `matchCollectable(item)`
1. Generate fingerprint via `makeLightweightFingerprint(item)`
2. Check `collectablesQueries.findByLightweightFingerprint()`
3. If no match, check `collectablesQueries.fuzzyMatch()` (Component 5)
4. Return existing collectable or null

### `saveToShelf(items, userId, shelfId)`
For each item:
1. Call `matchCollectable(item)`
2. If no match → `collectablesQueries.upsert(item)`
3. Call `shelvesQueries.addCollectable({ userId, shelfId, collectableId })`
4. Return added items

### `saveToReviewQueue(items, userId, shelfId)`
For each item:
1. Insert into `needs_review` table with raw data and confidence

---

## Dependencies
- Requires Component 1 (`parseToItems`, `enrichWithSchema`)
- Requires Component 5 (`fuzzyMatch`)
- Requires Component 6 (`needs_review` table)

---

## Testing

```bash
npm test -- visionPipeline
```

**Test cases (with mocks):**
1. Full pipeline: mock all services, verify flow
2. Confidence categorization works correctly
3. Items above threshold are saved to shelf
4. Items below threshold go to review queue

---

## Acceptance Criteria
- [ ] `VisionPipelineService` class created
- [ ] `processImage()` orchestrates full workflow
- [ ] Confidence threshold is configurable via `VISION_AUTO_ADD_THRESHOLD`
- [ ] High-confidence items auto-added to shelf
- [ ] Low-confidence items added to review queue
