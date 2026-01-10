const { makeLightweightFingerprint, makeVisionOcrFingerprint, normalizeFingerprintComponent } = require('../services/collectables/fingerprint');
const OpenAI = require("openai");

const { BookCatalogService } = require("../services/catalog/BookCatalogService");
const { GameCatalogService } = require("../services/catalog/GameCatalogService");
const { MovieCatalogService } = require("../services/catalog/MovieCatalogService");
const { GoogleCloudVisionService } = require('../services/googleCloudVision');
const { GoogleGeminiService } = require('../services/googleGemini');
const { VisionPipelineService } = require('../services/visionPipeline');

// PostgreSQL imports
const { query, transaction } = require('../database/pg');
const shelvesQueries = require('../database/queries/shelves');
const collectablesQueries = require('../database/queries/collectables');
const feedQueries = require('../database/queries/feed');
const { rowToCamelCase, parsePagination } = require('../database/queries/utils');
const needsReviewQueries = require('../database/queries/needsReview');
const { makeCollectableFingerprint } = require('../services/collectables/fingerprint');



let visionService;
let geminiService;

function getVisionService() {
  if (!visionService) {
    visionService = new GoogleCloudVisionService();
  }
  return visionService;
}

function getGeminiService() {
  if (!geminiService) {
    geminiService = new GoogleGeminiService();
  }
  return geminiService;
}

const VISIBILITY_OPTIONS = ["private", "friends", "public"];

const VISION_PROMPT_RULES = [
  {
    match: ["book", "books", "novel", "novels", "comic", "manga"],
    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a single book or a collection of books. Provide the canonical title, the primary author, and the physical format (e.g., hardcover, paperback, omnibus). Preserve accents, diacritics, and any mixed-language words exactly as printed; do not anglicize, translate, or substitute similarly sounding English phrases. If characters are ambiguous, match the visible glyphs rather than guessing a different word. Always populate the "genre" field when known. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Zoom into the photo if needed. Do not include explanations.`,
  },
  {
    match: ["movie", "movies", "film", "films", "blu-ray", "dvd", "4k"],
    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a movie or a collection of movies. Report the primary director in the "author" field, use "format" for the medium (Blu-ray, DVD, 4K, digital, etc.), use "publisher" for the studio or distributor, and provide the original release year. Always populate the "genre" field when known. If any metadata is missing, research reliable film databases before responding. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Do not include explanations.`,
  },
  {
    match: ["game", "games", "video game", "video games", "board game", "board games"],
    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a game or a collection of games. For video games, place the primary developer or studio in "primaryCreator" and also in "developer", set "format" to "physical", set "systemName" to the exact hardware/platform name, capture the publishing company in "publisher", note the release region in "region" when visible, include direct links in "urlCoverFront" and "urlCoverBack" when discernible, and provide the release year in "year". Always populate the "genre" field when known. For board games, use the lead designer in "author" and the publisher in "publisher". Search authoritative sources when information is missing. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Do not include explanations.`,
  },
  {
    match: ["music", "album", "albums", "vinyl", "records", "cd", "cds"],
    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a music collection (vinyl, CDs, tapes, etc.) Use "author" for the primary artist, "format" for the medium or edition, "publisher" for the record label, and "year" for the original release or pressing year. Always populate the "genre" field when known. If any detail is missing, consult trusted music databases before responding. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Do not include explanations.`,
  },
  {
    match: ["wine", "wines", "spirits", "liquor", "whisky", "whiskey", "bourbon", "tequila"],
    prompt: `You are assisting with cataloging physical collections. The user has indicated that this photo is a collection of wine or spirits. Use "author" for the producer, winery, or distillery, "format" for the varietal or bottle/edition details, "publisher" for the region or bottler, and "year" for the vintage or bottling year. Always populate the "genre" field when known. If any metadata is missing, research reputable wine or spirits sources before responding. Include "coordinates" in the format of "x,y" describing the relative physical location in the photo. Do not include explanations.`,
  },
];

function coerceNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parsePaginationParams(reqQuery, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const rawLimit = reqQuery?.limit ?? defaultLimit;
  let limit = parseInt(rawLimit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  limit = Math.min(Math.max(limit, 1), maxLimit);

  const rawSkip = reqQuery?.skip ?? 0;
  let skip = parseInt(rawSkip, 10);
  if (!Number.isFinite(skip) || skip < 0) skip = 0;

  return { limit, skip };
}

const DEFAULT_OCR_CONFIDENCE_THRESHOLD = 0.7;
const OCR_CONFIDENCE_THRESHOLD = (() => {
  const raw = parseFloat(process.env.OPENAI_VISION_OCR_CONFIDENCE_THRESHOLD || process.env.OPENAI_VISION_CONFIDENCE_THRESHOLD || "");
  if (Number.isFinite(raw)) return Math.max(0, Math.min(1, raw));
  return DEFAULT_OCR_CONFIDENCE_THRESHOLD;
})();

const VISION_FINGERPRINT_SOURCE = "vision-ocr";
const DEFAULT_AI_REVIEW_CONFIDENCE_THRESHOLD = 0.35;
const AI_REVIEW_CONFIDENCE_THRESHOLD = (() => {
  const raw = parseFloat(process.env.OPENAI_ENRICH_REVIEW_CONFIDENCE_THRESHOLD || process.env.OPENAI_ENRICH_CONFIDENCE_THRESHOLD || "");
  if (Number.isFinite(raw)) return Math.max(0, Math.min(1, raw));
  return DEFAULT_AI_REVIEW_CONFIDENCE_THRESHOLD;
})();

// PostgreSQL helper functions
async function loadShelfForUser(userId, shelfId) {
  return shelvesQueries.getById(parseInt(shelfId, 10), userId);
}

async function hydrateShelfItems(userId, shelfId, { limit, skip = 0 } = {}) {
  return shelvesQueries.getItems(shelfId, userId, { limit: limit || 100, offset: skip });
}

async function logShelfEvent({ userId, shelfId, type, payload }) {
  if (!userId || !shelfId || !type) return;
  try {
    await feedQueries.logEvent({
      userId,
      shelfId: parseInt(shelfId, 10),
      eventType: type,
      payload: payload || {},
    });
  } catch (err) {
    console.warn("Event log failed", err.message || err);
  }
}

// Catalog services
const bookCatalogService = new BookCatalogService();
const gameCatalogService = new GameCatalogService();
const movieCatalogService = new MovieCatalogService();
const catalogServices = [gameCatalogService, movieCatalogService, bookCatalogService];

function resolveCatalogServiceForShelf(type) {
  for (const service of catalogServices) {
    try {
      if (service.supportsShelfType(type)) return service;
    } catch (err) {
      console.error('[shelfVision.catalogService] supportsShelfType failed', { error: err?.message || err });
    }
  }
  return null;
}

function getVisionMaxOutputTokens() {
  const raw = parseInt(process.env.OPENAI_VISION_MAX_OUTPUT_TOKENS || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 4096;
}

function buildVisionPrompt(shelfType) {
  const normalized = String(shelfType || "").toLowerCase();
  for (const rule of VISION_PROMPT_RULES) {
    if (rule.match.some((m) => normalized.includes(m))) {
      return rule.prompt;
    }
  }
  return `You are assisting with cataloging physical collections. Identify all items visible in the photo with title, author/creator, format, and any other relevant metadata. Include "coordinates" describing the relative physical location. Do not include explanations.`;
}


// Structured vision format (same as original)
const structuredVisionFormat = {
  name: "ShelfCatalog",
  type: "json_schema",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      shelfConfirmed: { type: "boolean" },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            type: { type: "string" },
            primaryCreator: { type: ["string", "null"] },
            format: { type: ["string", "null"] },
            publisher: { type: ["string", "null"] },
            year: { type: ["string", "null"] },
            developer: { type: ["string", "null"] },
            region: { type: ["string", "null"] },
            systemName: { type: ["string", "null"] },
            urlCoverFront: { type: ["string", "null"] },
            urlCoverBack: { type: ["string", "null"] },
            genre: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }, { type: "null" }] },
            tags: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "string" }, { type: "null" }] },
            description: { type: ["string", "null"] },
            position: { type: ["number", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["title", "type", "primaryCreator", "region", "format", "position", "confidence", "publisher", "year", "developer", "genre", "tags", "description", "urlCoverFront", "urlCoverBack", "systemName"],
        },
      },
    },
    required: ["shelfConfirmed", "items"],
  },
};

// Controller functions
async function listShelves(req, res) {
  try {
    const { limit, skip } = parsePaginationParams(req.query, { defaultLimit: 20, maxLimit: 100 });

    const result = await query(
      `SELECT s.*, COUNT(uc.id) as item_count
       FROM shelves s
       LEFT JOIN user_collections uc ON uc.shelf_id = s.id
       WHERE s.owner_id = $1
       GROUP BY s.id
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, skip]
    );

    const countResult = await query(
      'SELECT COUNT(*) as total FROM shelves WHERE owner_id = $1',
      [req.user.id]
    );
    const total = parseInt(countResult.rows[0].total);

    res.json({
      shelves: result.rows.map(rowToCamelCase),
      pagination: { limit, skip, total, hasMore: skip + result.rows.length < total },
    });
  } catch (err) {
    console.error('listShelves error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function createShelf(req, res) {
  try {
    const { name, type, description } = req.body ?? {};
    if (!name || !type) return res.status(400).json({ error: "name and type are required" });

    const visibilityRaw = String(req.body.visibility ?? "private").toLowerCase();
    const visibility = VISIBILITY_OPTIONS.includes(visibilityRaw) ? visibilityRaw : "private";

    const shelf = await shelvesQueries.create({
      userId: req.user.id,
      name: String(name).trim(),
      type: String(type).trim(),
      description: description ?? "",
      visibility,
    });

    await logShelfEvent({
      userId: req.user.id,
      shelfId: shelf.id,
      type: "shelf.created",
      payload: { name: shelf.name, type: shelf.type, visibility: shelf.visibility },
    });

    res.status(201).json({ shelf });
  } catch (err) {
    console.error('createShelf error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getShelf(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });
    res.json({ shelf });
  } catch (err) {
    console.error('getShelf error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateShelf(req, res) {
  try {
    const shelf = await shelvesQueries.update(
      parseInt(req.params.shelfId, 10),
      req.user.id,
      req.body || {}
    );
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });
    res.json({ shelf });
  } catch (err) {
    console.error('updateShelf error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function listShelfItems(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const { limit, skip } = parsePaginationParams(req.query, { defaultLimit: 25, maxLimit: 200 });
    const items = await hydrateShelfItems(req.user.id, shelf.id, { limit, skip });

    const countResult = await query(
      'SELECT COUNT(*) as total FROM user_collections WHERE user_id = $1 AND shelf_id = $2',
      [req.user.id, shelf.id]
    );
    const total = parseInt(countResult.rows[0].total);

    res.json({
      items,
      pagination: { limit, skip, total, hasMore: skip + items.length < total },
    });
  } catch (err) {
    console.error('listShelfItems error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function addManualEntry(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const { name, type, description, author, publisher, format, year, tags } = req.body ?? {};
    if (!name) return res.status(400).json({ error: "name is required" });

    const result = await shelvesQueries.addManual({
      userId: req.user.id,
      shelfId: shelf.id,
      name: String(name).trim(),
      type,
      description,
      author,
      publisher,
      format,
      year,
      tags,
    });

    await logShelfEvent({
      userId: req.user.id,
      shelfId: shelf.id,
      type: "item.manual_added",
      payload: { itemId: result.collection.id, manualId: result.manual.id, name: result.manual.name, source: "manual" },
    });

    res.status(201).json({
      item: { id: result.collection.id, manual: result.manual, position: null, format: null, notes: null, rating: null },
    });
  } catch (err) {
    console.error('addManualEntry error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function addCollectable(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const { collectableId, format, notes, rating, position } = req.body ?? {};
    if (!collectableId) return res.status(400).json({ error: "collectableId is required" });

    const collectable = await collectablesQueries.findById(collectableId);
    if (!collectable) return res.status(404).json({ error: "Collectable not found" });

    const item = await shelvesQueries.addCollectable({
      userId: req.user.id,
      shelfId: shelf.id,
      collectableId: collectable.id,
      format,
      notes,
      rating,
      position,
    });

    await logShelfEvent({
      userId: req.user.id,
      shelfId: shelf.id,
      type: "item.collectable_added",
      payload: {
        itemId: item.id,
        collectableId: collectable.id,
        title: collectable.title,
        primaryCreator: collectable.primaryCreator,
        coverUrl: collectable.coverUrl || "",
        type: collectable.kind,
        source: "user",
      },
    });

    res.status(201).json({ item: { id: item.id, collectable, position: item.position, format: item.format, notes: item.notes, rating: item.rating } });
  } catch (err) {
    console.error('addCollectable error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function removeShelfItem(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const removed = await shelvesQueries.removeItem(
      parseInt(req.params.itemId, 10),
      req.user.id,
      shelf.id
    );
    if (!removed) return res.status(404).json({ error: "Item not found" });

    await logShelfEvent({
      userId: req.user.id,
      shelfId: shelf.id,
      type: "item.removed",
      payload: { itemId: req.params.itemId },
    });

    const items = await hydrateShelfItems(req.user.id, shelf.id);
    res.json({ removedId: req.params.itemId, items });
  } catch (err) {
    console.error('removeShelfItem error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function searchCollectablesForShelf(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const q = String(req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit || "10", 10), 50);

    const results = await collectablesQueries.searchByTitle(q, shelf.type, limit);
    res.json({ results });
  } catch (err) {
    console.error('searchCollectablesForShelf error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateManualEntry(req, res) {
  try {
    const { shelfId, itemId } = req.params;
    const shelf = await loadShelfForUser(req.user.id, shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const body = req.body ?? {};
    const updates = {};
    const allowedFields = ['name', 'type', 'description', 'author', 'publisher', 'format', 'year'];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = String(body[field]).trim();
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Get the collection entry with manual
    const entryResult = await query(
      `SELECT uc.id, uc.manual_id, um.* 
       FROM user_collections uc
       JOIN user_manuals um ON um.id = uc.manual_id
       WHERE uc.id = $1 AND uc.user_id = $2 AND uc.shelf_id = $3`,
      [itemId, req.user.id, shelf.id]
    );

    if (!entryResult.rows.length) {
      return res.status(404).json({ error: "Manual item not found" });
    }

    const entry = entryResult.rows[0];

    // Build update query for user_manuals
    const setClause = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...Object.values(updates), entry.manual_id];

    const updateResult = await query(
      `UPDATE user_manuals SET ${setClause} WHERE id = $${values.length} RETURNING *`,
      values
    );

    res.json({ item: { id: entry.id, manual: rowToCamelCase(updateResult.rows[0]) } });
  } catch (err) {
    console.error('updateManualEntry error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

// Vision processing (simplified - preserves core logic)
// Vision processing (using VisionPipelineService)
async function processShelfVision(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const { imageBase64, metadata: requestMetadata = {} } = req.body ?? {};
    if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required" });

    // Premium Check
    if (!req.user.isPremium) {
      return res.status(403).json({
        error: "Vision features are premium only.",
        requiresPremium: true
      });
    }

    console.log(`[Vision] Processing image for shelf ${shelf.id} (${shelf.type})`);

    // Instantiate new Pipeline
    const pipeline = new VisionPipelineService();

    // Process Image
    // Note: processImage returns { analysis, results, addedItems, needsReview }
    const result = await pipeline.processImage(imageBase64, shelf, req.user.id);

    // Get updated shelf items
    const items = await hydrateShelfItems(req.user.id, shelf.id);

    res.json({
      analysis: result.analysis,
      results: result.results,
      addedItems: result.addedItems,
      needsReview: result.needsReview,
      items,
      visionStatus: { status: 'completed', provider: 'google-vision-gemini-pipeline' },
      metadata: requestMetadata
    });

  } catch (err) {
    console.error("Vision analysis failed", err);
    res.status(502).json({ error: "Vision analysis failed" });
  }
}

async function processCatalogLookup(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const { items: rawItems, autoApply = true } = req.body ?? {};
    if (!Array.isArray(rawItems) || !rawItems.length) {
      return res.status(400).json({ error: "items array is required" });
    }

    // Normalize items for enrichment
    const normalizedItems = rawItems.map(item => ({
      title: item.name || item.title,
      author: item.author || item.primaryCreator || null,
      type: shelf.type,
      // minimal fields
    }));

    const geminiSvc = getGeminiService();
    let finalItems = normalizedItems;

    if (geminiSvc.isConfigured()) {
      console.log(`[CatalogLookup] Enriching ${normalizedItems.length} items with Gemini`);
      finalItems = await geminiSvc.enrichShelfItems(normalizedItems, shelf.type);
    }

    // Return as analysis result
    const parsed = {
      shelfConfirmed: true,
      items: finalItems
    };

    res.json({
      analysis: parsed,
      results: [], // No database changes yet
      items: await hydrateShelfItems(req.user.id, shelf.id),
    });

  } catch (err) {
    console.error("Catalog lookup failed", err);
    res.status(500).json({ error: "Catalog lookup failed" });
  }
}

async function listReviewItems(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const items = await needsReviewQueries.listPending(req.user.id, shelf.id);
    res.json({ items });
  } catch (err) {
    console.error('listReviewItems error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function completeReviewItem(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });

    const reviewItem = await needsReviewQueries.getById(req.params.id, req.user.id);
    if (!reviewItem) return res.status(404).json({ error: "Review item not found" });

    // Merge user edits with raw data
    // Prioritize user body over rawData
    const completedData = { ...reviewItem.rawData, ...req.body };

    // RE-MATCH: Run fingerprint + fuzzy match to prevent duplicates
    // makeLightweightFingerprint(item) helper from existing imports? 
    // shelvesController imports `makeLightweightFingerprint` at the top (line 1).
    const lwf = makeLightweightFingerprint(completedData);
    let collectable = await collectablesQueries.findByLightweightFingerprint(lwf);

    if (!collectable) {
      collectable = await collectablesQueries.fuzzyMatch(
        completedData.title,
        completedData.primaryCreator,
        shelf.type
      );
    }

    if (!collectable) {
      // No match found - create new collectable
      collectable = await collectablesQueries.upsert({
        ...completedData,
        kind: shelf.type,
        fingerprint: makeCollectableFingerprint(completedData), // Imported/Available?
        lightweightFingerprint: lwf,
      });
    }

    // Add to user's shelf
    const item = await shelvesQueries.addCollectable({
      userId: req.user.id,
      shelfId: shelf.id,
      collectableId: collectable.id,
    });

    // Mark review item as completed
    await needsReviewQueries.markCompleted(reviewItem.id, req.user.id);

    // Log event
    await logShelfEvent({
      userId: req.user.id,
      shelfId: shelf.id,
      type: "item.collectable_added",
      payload: { source: "review", reviewItemId: reviewItem.id },
    });

    res.json({ item: { id: item.id, collectable, position: item.position, notes: item.notes, rating: item.rating } });
  } catch (err) {
    console.error('completeReviewItem error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function dismissReviewItem(req, res) {
  try {
    const result = await needsReviewQueries.dismiss(req.params.id, req.user.id);
    if (!result) return res.status(404).json({ error: "Review item not found" });
    res.json({ dismissed: true, id: req.params.id });
  } catch (err) {
    console.error('dismissReviewItem error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}


module.exports = {
  listShelves,
  createShelf,
  getShelf,
  updateShelf,
  listShelfItems,
  addManualEntry,
  addCollectable,
  searchCollectablesForShelf,
  removeShelfItem,
  processShelfVision,
  processCatalogLookup,
  processCatalogLookup,
  updateManualEntry,
  listReviewItems,
  completeReviewItem,
  dismissReviewItem,
};
