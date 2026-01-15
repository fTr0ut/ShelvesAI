# Phase 4: Mobile ML Kit OCR

## Overview
**Goal**: Add on-device OCR using ML Kit (via expo-ocr) for fast, free, offline-capable scanning.  
**Duration**: ~4-6 hours  
**Prerequisites**: Phase 3 complete

---

## Task 4.1: Install expo-ocr Package
**Priority**: 🔴 Critical | **Time**: 15 min

```bash
cd mobile
npx expo install expo-ocr
```

**Note**: expo-ocr requires EAS Build (won't work in Expo Go).

**Acceptance Criteria**:
- [ ] expo-ocr installed
- [ ] No immediate errors in package.json

---

## Task 4.2: Set Up EAS Build
**Priority**: 🔴 Critical | **Time**: 1 hour

If not already set up:

```bash
# Install EAS CLI
npm install -g eas-cli

# Login
eas login

# Initialize EAS
cd mobile
eas build:configure
```

**Create/Update**: `mobile/eas.json`
```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "ios": { "simulator": true }
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {}
  }
}
```

**Build development client**:
```bash
# Android
eas build --profile development --platform android

# iOS (simulator)
eas build --profile development --platform ios
```

**Acceptance Criteria**:
- [ ] EAS configured
- [ ] Development build created for Android or iOS
- [ ] Can install and run dev client

---

## Task 4.3: Create OCR Service Module
**Priority**: 🔴 Critical | **Time**: 45 min

**Create**: `mobile/src/services/ocr.js`

```javascript
import { recognizeText } from 'expo-ocr';

/**
 * Extract text from image using on-device ML Kit
 * @param {string} imageUri - Local file URI
 * @returns {Promise<{text: string, lines: string[]}>}
 */
export async function extractTextFromImage(imageUri) {
  const result = await recognizeText(imageUri);
  const text = result.text || '';
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  return { text, lines };
}

/**
 * Parse OCR text into structured items
 * @param {string} text - Raw OCR text
 * @param {string} shelfType - Type of shelf (book, movie, etc.)
 * @returns {Array<{name: string, type: string}>}
 */
export function parseTextToItems(text, shelfType) {
  const lines = text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 3);
  
  // Group lines that might be title + author
  const items = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // Skip obviously non-title lines
    if (line.match(/^\d+$/) || line.match(/^[\$£€]/)) {
      i++;
      continue;
    }
    
    // Check if next line might be author
    const nextLine = lines[i + 1];
    const mightBeAuthor = nextLine && 
      !nextLine.match(/^\d+$/) &&
      nextLine.length < line.length;
    
    if (mightBeAuthor && shelfType === 'book') {
      items.push({
        name: line,
        author: nextLine,
        type: shelfType,
      });
      i += 2;
    } else {
      items.push({
        name: line,
        type: shelfType,
      });
      i++;
    }
  }
  
  return items;
}
```

**Acceptance Criteria**:
- [ ] OCR service created
- [ ] Text extraction function
- [ ] Item parsing logic

---

## Task 4.4: Update ShelfDetailScreen with Scan Modes
**Priority**: 🔴 Critical | **Time**: 1.5 hours

**Modify**: `mobile/src/screens/ShelfDetailScreen.js`

**Add state for scan mode**:
```javascript
const [scanMode, setScanMode] = useState('quick'); // 'quick' | 'cloud'
```

**Add scan mode toggle UI**:
```javascript
<View style={styles.scanModeContainer}>
  <Text>Scan Mode:</Text>
  <TouchableOpacity 
    onPress={() => setScanMode('quick')}
    style={[styles.modeButton, scanMode === 'quick' && styles.modeActive]}
  >
    <Text>Quick (On-Device)</Text>
  </TouchableOpacity>
  <TouchableOpacity 
    onPress={() => setScanMode('cloud')}
    style={[styles.modeButton, scanMode === 'cloud' && styles.modeActive]}
  >
    <Text>AI Scan (Cloud)</Text>
  </TouchableOpacity>
</View>
```

**Add Quick Scan handler**:
```javascript
import { extractTextFromImage, parseTextToItems } from '../services/ocr';

const handleQuickScan = async (imageUri) => {
  setScanning(true);
  try {
    const { text } = await extractTextFromImage(imageUri);
    const items = parseTextToItems(text, shelf.type);
    
    // Send to catalog lookup endpoint
    const response = await fetch(`${apiBase}/api/shelves/${shelfId}/catalog-lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ items, autoApply: true }),
    });
    
    const result = await response.json();
    // Handle result...
  } finally {
    setScanning(false);
  }
};
```

**Acceptance Criteria**:
- [ ] Scan mode toggle UI added
- [ ] Quick scan uses ML Kit
- [ ] Cloud scan uses existing flow
- [ ] Results handled properly

---

## Task 4.5: Create Catalog Lookup Endpoint
**Priority**: 🔴 Critical | **Time**: 1 hour

**Add to**: `api/routes/shelves.js`
```javascript
router.post('/:shelfId/catalog-lookup', requireAuth, shelvesController.processCatalogLookup);
```

**Add to**: `api/controllers/shelvesController.js`
```javascript
async function processCatalogLookup(req, res) {
  const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
  if (!shelf) return res.status(404).json({ error: 'Shelf not found' });
  
  const { items, autoApply = true } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items array required' });
  }
  
  // Normalize items
  const normalizedItems = sanitizeVisionItems(items, shelf.type);
  
  // Match existing collectables by fingerprint
  const fingerprintMatches = await matchExistingCollectables(
    normalizedItems, req.user.id, shelf
  );
  
  // Catalog lookup for remaining
  const catalogService = resolveCatalogServiceForShelf(shelf.type);
  let resolved = [];
  let unresolved = fingerprintMatches.remaining.map(i => ({ status: 'unresolved', input: i }));
  
  if (catalogService) {
    const firstPass = await catalogService.lookupFirstPass(fingerprintMatches.remaining);
    resolved = firstPass.filter(r => r.status === 'resolved');
    unresolved = firstPass.filter(r => r.status === 'unresolved');
  }
  
  // OpenAI enrichment for unresolved
  const openaiClient = getOpenAIClient();
  let enriched = [];
  if (catalogService && openaiClient && unresolved.length > 0) {
    enriched = await catalogService.enrichWithOpenAI(unresolved, openaiClient);
  }
  
  // Apply results (same logic as processShelfVision)
  // ... existing apply logic ...
  
  const shelfItems = await hydrateShelfItems(req.user.id, shelf._id);
  res.json({ results: [...fingerprintMatches.results, ...resolved, ...enriched], items: shelfItems });
}

module.exports = {
  // ... existing exports
  processCatalogLookup,
};
```

**Acceptance Criteria**:
- [ ] Endpoint created
- [ ] Accepts pre-parsed items
- [ ] Runs catalog lookup
- [ ] Runs AI enrichment
- [ ] Returns results

---

## Task 4.6: Test On-Device OCR
**Priority**: 🔴 Critical | **Time**: 45 min

**Test Steps**:
1. Build development client (if not done)
2. Install on physical device
3. Navigate to a shelf
4. Select "Quick Scan" mode
5. Take photo of books/DVDs
6. Verify items are detected
7. Verify catalog lookup runs
8. Check items added to shelf

**Test Checklist**:
- [ ] ML Kit OCR runs on device
- [ ] Text extracted correctly
- [ ] Items parsed from text
- [ ] Catalog lookup succeeds
- [ ] Items appear on shelf

---

## Task 4.7: Add Loading and Error States
**Priority**: 🟡 Medium | **Time**: 30 min

Update ShelfDetailScreen with:
- Loading spinner during scan
- Error message display
- Retry button on failure
- Results summary before applying

---

## Completion Checklist
- [ ] expo-ocr installed
- [ ] EAS Build configured
- [ ] Development client built
- [ ] OCR service created
- [ ] ShelfDetailScreen updated with scan modes
- [ ] Catalog lookup endpoint created
- [ ] On-device OCR tested
- [ ] Error handling added
