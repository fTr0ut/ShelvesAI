# Phase 3: Vision API Migration

## Overview
**Goal**: Replace OpenAI Vision with Google Cloud Vision for image OCR while keeping OpenAI for text-based catalog enrichment.  
**Duration**: ~4-6 hours  
**Prerequisites**: Phase 2 complete

---

## Task 3.1: Set Up Google Cloud Project
**Priority**: 🔴 Critical | **Time**: 30 min

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project or select existing
3. Enable "Cloud Vision API"
4. Create Service Account:
   - IAM & Admin → Service Accounts → Create
   - Name: `shelvesai-vision`
   - Role: `Cloud Vision API User`
5. Create key (JSON) and download
6. Save to `api/credentials/gcp-service-account.json`
7. Add to `.gitignore`: `**/credentials/*.json`

**Acceptance Criteria**:
- [ ] Cloud Vision API enabled
- [ ] Service account created
- [ ] JSON key downloaded
- [ ] Key added to credentials folder (not committed)

---

## Task 3.2: Install Google Cloud Vision Package
**Priority**: 🔴 Critical | **Time**: 10 min

```bash
cd api
npm install @google-cloud/vision
```

**Acceptance Criteria**:
- [ ] Package installed in api/package.json

---

## Task 3.3: Create Google Cloud Vision Service
**Priority**: 🔴 Critical | **Time**: 1.5 hours

**Create**: `api/services/googleCloudVision.js`

```javascript
const vision = require('@google-cloud/vision');

class GoogleCloudVisionService {
  constructor() {
    this.client = new vision.ImageAnnotatorClient();
  }

  async extractText(base64Image) {
    const cleaned = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
    const [result] = await this.client.textDetection({
      image: { content: cleaned }
    });
    return {
      text: result.textAnnotations?.[0]?.description || '',
      confidence: 0.9
    };
  }

  async detectShelfItems(base64Image, shelfType) {
    const cleaned = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
    const [result] = await this.client.documentTextDetection({
      image: { content: cleaned }
    });
    const items = this.parseDocumentToItems(result, shelfType);
    return { items };
  }

  parseDocumentToItems(result, shelfType) {
    const text = result.fullTextAnnotation?.text || '';
    const lines = text.split('\n').filter(Boolean);
    return lines
      .filter(line => line.length > 3)
      .map(line => ({
        name: line.trim(),
        type: shelfType,
        confidence: 0.85
      }));
  }
}

module.exports = { GoogleCloudVisionService };
```

**Acceptance Criteria**:
- [ ] Service class created
- [ ] `extractText()` works
- [ ] `detectShelfItems()` parses lines into items

---

## Task 3.4: Update shelvesController for GCV
**Priority**: 🔴 Critical | **Time**: 1.5 hours

**Modify**: `api/controllers/shelvesController.js`

1. Add import:
```javascript
const { GoogleCloudVisionService } = require('../services/googleCloudVision');
```

2. Add lazy initialization:
```javascript
let visionService;
function getVisionService() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;
  if (!visionService) {
    visionService = new GoogleCloudVisionService();
  }
  return visionService;
}
```

3. Update `processShelfVision()`:
   - Replace `getOpenAIClient()` call for Vision with `getVisionService()`
   - Replace OpenAI `responses.create()` image call with `visionService.detectShelfItems()`
   - Keep `getOpenAIClient()` for `enrichWithOpenAI()` catalog fallback

**Key Changes**:
```javascript
async function processShelfVision(req, res) {
  const visionSvc = getVisionService();
  const openaiClient = getOpenAIClient(); // Still needed for enrichment
  
  if (!visionSvc) {
    return res.status(503).json({ 
      error: 'Vision AI not configured (set GOOGLE_APPLICATION_CREDENTIALS)' 
    });
  }
  
  // Use Google Cloud Vision for OCR
  const visionResult = await visionSvc.detectShelfItems(imageDataUrl, shelf.type);
  const normalizedItems = sanitizeVisionItems(visionResult.items, shelf.type);
  
  // Continue with existing catalog lookup + OpenAI enrichment...
}
```

**Acceptance Criteria**:
- [ ] Google Cloud Vision used for image OCR
- [ ] OpenAI still used for `enrichWithOpenAI()`
- [ ] Error handling for missing credentials
- [ ] Existing flow preserved

---

## Task 3.5: Update Environment Configuration
**Priority**: 🔴 Critical | **Time**: 15 min

**Update**: `api/.env.example`
```bash
# Google Cloud Vision
GOOGLE_APPLICATION_CREDENTIALS=./credentials/gcp-service-account.json
```

**Update**: `api/.env` (local copy)
```bash
GOOGLE_APPLICATION_CREDENTIALS=./credentials/gcp-service-account.json
```

**Acceptance Criteria**:
- [ ] Environment variable documented
- [ ] Local .env updated

---

## Task 3.6: Test Vision API
**Priority**: 🔴 Critical | **Time**: 45 min

**Create test script**: `api/scripts/test-vision.js`

```javascript
require('dotenv').config();
const fs = require('fs');
const { GoogleCloudVisionService } = require('../services/googleCloudVision');

async function test() {
  const service = new GoogleCloudVisionService();
  
  // Test with a sample image (create or download a shelf image)
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.log('Usage: node test-vision.js <image-path>');
    process.exit(1);
  }
  
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');
  
  console.log('Testing text extraction...');
  const textResult = await service.extractText(base64);
  console.log('Extracted text:', textResult.text.substring(0, 200));
  
  console.log('\nTesting shelf item detection...');
  const itemResult = await service.detectShelfItems(base64, 'book');
  console.log('Detected items:', itemResult.items.slice(0, 5));
}

test().catch(console.error);
```

**Test**:
```bash
node api/scripts/test-vision.js path/to/shelf-image.jpg
```

**Acceptance Criteria**:
- [ ] Test script created
- [ ] Text extraction works
- [ ] Item detection returns structured data

---

## Task 3.7: Update API Documentation
**Priority**: 🟢 Low | **Time**: 20 min

Update `api/openapi.yaml` (if exists) or `README.md`:
- Document new `GOOGLE_APPLICATION_CREDENTIALS` requirement
- Note that OpenAI is still required for catalog enrichment
- Update vision endpoint documentation

---

## Completion Checklist
- [ ] Google Cloud project set up
- [ ] Cloud Vision API enabled
- [ ] Service account created
- [ ] @google-cloud/vision installed
- [ ] GoogleCloudVisionService created
- [ ] shelvesController updated
- [ ] Environment variables configured
- [ ] Vision API tested
- [ ] Documentation updated
