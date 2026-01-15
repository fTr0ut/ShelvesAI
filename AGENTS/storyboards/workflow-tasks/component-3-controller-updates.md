# Component 3: Controller Updates

## Objective
Refactor `processShelfVision` controller to use the new `VisionPipelineService` and return structured results.

## File to Modify

### `api/controllers/shelvesController.js`

---

## Changes

### 1. Import VisionPipelineService

```javascript
const { VisionPipelineService } = require('../services/visionPipeline');
```

### 2. Refactor `processShelfVision` Function

**Before:**
```javascript
async function processShelfVision(req, res) {
  // Current: OCR → Gemini → return analysis JSON
  const visionResult = await visionSvc.detectShelfItems(...);
  const finalItems = await geminiSvc.enrichShelfItems(...);
  res.json({ analysis: { items: finalItems }, results: [] });
}
```

**After:**
```javascript
async function processShelfVision(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const { imageBase64 } = req.body ?? {};
    if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required" });

    // Premium check
    if (!req.user.isPremium) {
      return res.status(403).json({ error: "Vision features are premium only.", requiresPremium: true });
    }

    // Use new pipeline
    const pipeline = new VisionPipelineService();
    const result = await pipeline.processImage(imageBase64, shelf, req.user.id);

    // Return structured response
    const items = await hydrateShelfItems(req.user.id, shelf.id);
    res.json({
      analysis: result.analysis,
      results: result.results,
      addedItems: result.addedItems,
      needsReview: result.needsReview,
      items,
      visionStatus: { status: 'completed', provider: 'google-vision-gemini' }
    });
  } catch (err) {
    console.error("Vision analysis failed", err);
    res.status(502).json({ error: "Vision analysis failed" });
  }
}
```

---

## Response Schema

```typescript
interface VisionResponse {
  analysis: {
    shelfConfirmed: boolean;
    items: VisionItem[];
  };
  results: {
    added: number;
    needsReview: number;
  };
  addedItems: UserCollectionItem[];
  needsReview: NeedsReviewItem[];
  items: ShelfItem[];
  visionStatus: {
    status: 'completed' | 'failed';
    provider: string;
  };
}
```

---

## Dependencies
- Requires Component 2 (`VisionPipelineService`)

---

## Testing

Test via API call:
```bash
curl -X POST http://localhost:3000/api/shelves/1/vision \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"imageBase64": "..."}'
```

Verify response includes:
- `addedItems` array (items auto-added to shelf)
- `needsReview` array (items below confidence threshold)
- `results.added` count matches `addedItems.length`

---

## Acceptance Criteria
- [ ] `processShelfVision` uses `VisionPipelineService`
- [ ] Response includes `addedItems` and `needsReview` arrays
- [ ] `results` object shows counts for added/needsReview
- [ ] Existing premium check preserved
- [ ] Error handling preserved
