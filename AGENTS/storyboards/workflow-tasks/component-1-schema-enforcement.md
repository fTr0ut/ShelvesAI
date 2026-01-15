# Component 1: Schema Enforcement (Cloud Vision + Gemini)

## Objective
Constrain AI service outputs to match the collectables database schema, reducing payload size and ensuring consistent data.

## Files to Modify

### 1. `api/services/googleCloudVision.js`

**Add new method: `parseToItems(ocrText, shelfType)`**

```javascript
/**
 * Parse raw OCR text into minimal item objects.
 * @param {string} ocrText - Full text from OCR
 * @param {string} shelfType - Type of shelf (book, game, movie, etc.)
 * @returns {Array<{title: string, author: string|null}>}
 */
parseToItems(ocrText, shelfType) {
  // Split text into lines
  // Apply category-specific heuristics:
  //   - Books: Look for "by" patterns, title case
  //   - Games: Platform indicators, publisher patterns
  //   - Movies: Year patterns, director indicators
  // Return array of {title, author} objects
}
```

**Category Heuristics:**
- **Books**: Lines with "by [Author]", title case patterns
- **Games**: Platform suffixes (PS5, Xbox, Switch), exclude ratings
- **Movies**: Year in parentheses, director detection

---

### 2. `api/services/googleGemini.js`

**Add new method: `enrichWithSchema(items, shelfType)`**

```javascript
/**
 * Enrich minimal items with full collectable metadata.
 * @param {Array<{title, author}>} items - Minimal items from vision
 * @param {string} shelfType
 * @returns {Promise<Array<CollectableSchema>>}
 */
async enrichWithSchema(items, shelfType) {
  // Build category-specific prompt
  // Use structured output mode
  // Return full schema objects
}
```

**Output Schema** (matches collectables table):
```typescript
interface CollectableSchema {
  title: string;
  primaryCreator: string | null;
  year: string | null;
  kind: string;
  publishers: string[];
  tags: string[];
  identifiers: object;
  description: string | null;
  format: string | null;
  confidence: number;
}
```

---

## Category-Specific Prompts

Store in `CATEGORY_PROMPTS` constant:

| Category | Key Fields |
|----------|------------|
| book | title, author, publisher, year, ISBN |
| game | title, developer, publisher, platform, year |
| movie | title, director, studio, year, format |
| music | title, artist, label, year, format |

---

## Testing

```bash
npm test -- googleCloudVision
npm test -- googleGemini
```

**Test cases:**
1. `parseToItems` correctly extracts titles from sample OCR text
2. `enrichWithSchema` returns valid schema objects
3. Output conforms to collectables table structure

---

## Acceptance Criteria
- [ ] `parseToItems()` reduces 7000+ line payloads to <50 item objects
- [ ] `enrichWithSchema()` returns schema-compliant JSON
- [ ] Category-specific prompts exist for books, games, movies, music
- [ ] Unit tests pass
