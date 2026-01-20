const { GoogleGeminiService, getVisionSettingsForType } = require('./googleGemini');
// const { GoogleCloudVisionService } = require('./googleCloudVision'); // Temporarily disabled; keep for easy re-enable.
const collectablesQueries = require('../database/queries/collectables');
const needsReviewQueries = require('../database/queries/needsReview');
const shelvesQueries = require('../database/queries/shelves');
const feedQueries = require('../database/queries/feed');
const {
    makeCollectableFingerprint,
    makeLightweightFingerprint,
    makeVisionOcrFingerprint,
    makeManualFingerprint,
} = require('./collectables/fingerprint');
const processingStatus = require('./processingStatus');
const path = require('path');
const fs = require('fs');
const {
    normalizeOtherManualItem,
    buildOtherManualPayload,
    hasRequiredOtherFields,
} = require('./manuals/otherManual');

// Catalog Services
const { BookCatalogService } = require('./catalog/BookCatalogService');
const { GameCatalogService } = require('./catalog/GameCatalogService');
const { MovieCatalogService } = require('./catalog/MovieCatalogService');

// Load progress messages config
let progressMessagesConfig = {};
try {
    const configPath = path.join(__dirname, '..', 'config', 'visionProgressMessages.json');
    progressMessagesConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
    console.warn('[VisionPipeline] Could not load visionProgressMessages.json, using defaults:', err.message);
}

/**
 * Get a progress message from config with optional template substitution
 * @param {string} key - Config key (e.g., 'extracting', 'matching')
 * @param {object} vars - Variables for template substitution (e.g., { count: 5 })
 */
function getProgressMessage(key, vars = {}) {
    const cfg = progressMessagesConfig.progressMessages?.[key] || {};
    let message = cfg.message || cfg.messageTemplate || `Processing ${key}...`;
    // Replace template variables like {count}
    for (const [varName, value] of Object.entries(vars)) {
        message = message.replace(new RegExp(`\\{${varName}\\}`, 'g'), value);
    }
    return {
        step: cfg.step || key,
        progress: cfg.progress ?? 0,
        message,
    };
}

// Default tiered confidence thresholds (can be overridden per-type via visionSettings.json)
// High confidence (≥ max): catalog workflow
// Medium confidence (≥ min, < max): special enrichment only (skip catalog APIs)
// Low confidence (< min): needs_review directly
const DEFAULT_CONFIDENCE_MAX = parseFloat(process.env.VISION_CONFIDENCE_MAX || '0.92');
const DEFAULT_CONFIDENCE_MIN = parseFloat(process.env.VISION_CONFIDENCE_MIN || '0.85');
const FEED_EVENT_ITEM_ID_CAP = parseInt(process.env.FEED_EVENT_ITEM_ID_CAP || '250', 10);
const OTHER_SHELF_TYPE = 'other';

function isOtherShelfType(value) {
    return String(value || '').toLowerCase() === OTHER_SHELF_TYPE;
}

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

function normalizeStringArray(...values) {
    const out = [];
    values.forEach((value) => {
        if (!value) return;
        if (Array.isArray(value)) {
            value.forEach((entry) => out.push(entry));
        } else {
            out.push(value);
        }
    });
    const normalized = out
        .map((entry) => normalizeString(entry))
        .filter(Boolean);
    return Array.from(new Set(normalized));
}

function normalizeArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value];
}

function normalizeIdentifiers(value) {
    if (!value) return {};
    if (value instanceof Map) return Object.fromEntries(value.entries());
    if (Array.isArray(value)) return {};
    if (typeof value === 'object') return value;
    return {};
}

function pickCoverUrl(images, fallback) {
    if (fallback) return fallback;
    if (!Array.isArray(images)) return null;
    for (const image of images) {
        const candidate = image?.urlLarge || image?.urlMedium || image?.urlSmall || image?.url;
        if (candidate) return candidate;
    }
    return null;
}

function isMissingRelationError(err, tableName) {
    if (!err) return false;
    if (err.code === '42P01') return true;
    const message = String(err.message || err);
    return tableName ? message.includes(tableName) : false;
}

class VisionPipelineService {
    constructor() {
        this.geminiService = new GoogleGeminiService();
        // this.visionService = new GoogleCloudVisionService();
        this.reviewQueueAvailable = true;

        // Initialize catalogs
        this.catalogs = {
            book: new BookCatalogService(),
            game: new GameCatalogService(),
            movie: new MovieCatalogService(),
            // fallback/music could go here
        };
    }

    resolveCatalogServiceForShelf(shelfType) {
        // Iterate through all available catalogs
        for (const key in this.catalogs) {
            const service = this.catalogs[key];
            // Check if service has supportsShelfType method (it should)
            if (service.supportsShelfType && service.supportsShelfType(shelfType)) {
                return service;
            }
        }
        // Fallback for strict matches or simple types if supportsShelfType is missing/fails
        return this.catalogs[shelfType] || null;
    }

    /**
     * Main entry point: process image and return results
     * 
     * Workflow:
     * 1. Extract items from image (Gemini Vision)
     * 1b. Early categorize - low confidence OCR items → needs_review immediately
     * 2. matchCollectable (fingerprint + fuzzy lookup in Postgres)
     * 3. lookupCatalog (OpenLibrary → Hardcover) for unmatched items
     * 4. enrichUnresolved (Gemini) - ONLY if both fingerprint AND catalog fail
     * 5. Final save to shelf + remaining needs_review items
     * 
     * @param {string} imageBase64 - Base64 encoded image
     * @param {object} shelf - Shelf object with id and type
     * @param {number} userId - User ID
     * @param {string} [jobId] - Optional job ID for progress tracking
     */
    async processImage(imageBase64, shelf, userId, jobId = null) {
        if (!shelf || !shelf.type) throw new Error('Invalid shelf provided');
        console.log('[VisionPipeline] === Starting processImage ===', { shelfId: shelf.id, shelfType: shelf.type, userId, jobId });

        // Helper to update progress if jobId is provided (uses config for messaging)
        const updateProgress = (key, vars = {}) => {
            if (jobId) {
                const { step, progress, message } = getProgressMessage(key, vars);
                processingStatus.updateJob(jobId, { step, progress, message, status: 'processing' });
            }
        };

        // Helper to check if job was aborted
        const checkAborted = () => {
            if (jobId && processingStatus.isAborted(jobId)) {
                throw new Error('Processing cancelled by user');
            }
        };

        // Track any warnings from enrichment (e.g., truncated responses)
        const warnings = [];

        // Get per-type confidence thresholds from config
        const typeSettings = getVisionSettingsForType(shelf.type);
        const confidenceMax = typeSettings.confidenceMax ?? DEFAULT_CONFIDENCE_MAX;
        const confidenceMin = typeSettings.confidenceMin ?? DEFAULT_CONFIDENCE_MIN;
        console.log('[VisionPipeline] Using confidence thresholds for', shelf.type, ':', { max: confidenceMax, min: confidenceMin });

        // Step 1: Extract items from image
        checkAborted();
        updateProgress('extracting');
        console.log('[VisionPipeline] Step 1: Extracting items from image via Gemini Vision...');
        const rawItems = await this.extractItems(imageBase64, shelf.type, shelf.description, shelf.name);
        console.log('[VisionPipeline] Step 1 Complete: Extracted', rawItems.length, 'items:', rawItems.map(i => i.title || i.name));
        const isOtherShelf = isOtherShelfType(shelf.type);
        const normalizedItems = isOtherShelf
            ? rawItems.map(item => normalizeOtherManualItem(item, shelf.type))
            : rawItems;

        // Step 1b: Categorize into three tiers using per-type thresholds
        checkAborted();
        updateProgress('categorizing', { count: normalizedItems.length });
        console.log('[VisionPipeline] Step 1b: Categorizing by confidence tiers...');
        const { highConfidence, mediumConfidence, lowConfidence } = this.categorizeByConfidence(
            normalizedItems,
            confidenceMax,
            confidenceMin,
        );

        // Low confidence items go directly to needs_review
        if (lowConfidence.length > 0) {
            console.log('[VisionPipeline] Sending', lowConfidence.length, 'low-confidence items (<' + confidenceMin + ') to review queue...');
            await this.saveToReviewQueue(lowConfidence, userId, shelf.id);
        }

        if (isOtherShelf) {
            checkAborted();
            updateProgress('matching', { count: highConfidence.length });
            const highWithFingerprint = highConfidence.map((item) => ({
                ...item,
                manualFingerprint: makeManualFingerprint(
                    {
                        title: item.title || item.name,
                        primaryCreator: item.primaryCreator || item.author || item.creator,
                        kind: shelf.type,
                    },
                    'manual-other',
                ),
            }));

            const candidates = [...highWithFingerprint, ...mediumConfidence];
            const itemsToSave = [];
            const itemsToReview = [];

            for (const item of candidates) {
                if (hasRequiredOtherFields(item)) {
                    itemsToSave.push(item);
                } else {
                    itemsToReview.push(item);
                }
            }

            if (itemsToReview.length > 0) {
                console.log('[VisionPipeline] Sending', itemsToReview.length, 'incomplete items to review queue...');
                await this.saveToReviewQueue(itemsToReview, userId, shelf.id);
            }

            checkAborted();
            updateProgress('preparingOther', { count: itemsToSave.length });
            console.log('[VisionPipeline] Saving', itemsToSave.length, 'other items to shelf...');
            updateProgress('saving', { count: itemsToSave.length });
            const manualResult = await this.saveManualToShelf(itemsToSave, userId, shelf.id, shelf.type);
            const addedItems = manualResult.added || [];
            const matchedItems = manualResult.matched || [];
            const skippedItems = manualResult.skipped || [];
            const allResolvedItems = [...addedItems, ...matchedItems];

            // Route skipped items (missing title or primaryCreator) to review queue
            if (skippedItems.length > 0) {
                console.log('[VisionPipeline] Routing', skippedItems.length, 'skipped items (missing fields) to review queue...');
                await this.saveToReviewQueue(skippedItems, userId, shelf.id);
            }

            if (addedItems.length > 0) {
                const previewLimit = parseInt(process.env.FEED_AGGREGATE_PREVIEW_LIMIT || '5', 10);
                const summaryItems = addedItems.map((item) => ({
                    itemId: item.itemId,
                    manualId: item.manualId,
                    name: item.title || item.name || null,
                    author: item.primaryCreator || item.author || null,
                    ageStatement: item.ageStatement || null,
                    year: item.year || null,
                    specialMarkings: item.specialMarkings || null,
                    labelColor: item.labelColor || null,
                    regionalItem: item.regionalItem || null,
                    edition: item.edition || null,
                    description: item.description || null,
                    barcode: item.barcode || null,
                    limitedEdition: item.limitedEdition || null,
                    itemSpecificText: item.itemSpecificText || null,
                    type: item.type || item.kind || shelf.type,
                }));
                const itemIds = summaryItems.map((item) => item.itemId).filter(Boolean);
                const cappedItemIds = Number.isFinite(FEED_EVENT_ITEM_ID_CAP) && FEED_EVENT_ITEM_ID_CAP > 0
                    ? itemIds.slice(0, FEED_EVENT_ITEM_ID_CAP)
                    : itemIds;

                try {
                    await feedQueries.logEvent({
                        userId,
                        shelfId: shelf.id,
                        eventType: 'item.manual_added',
                        payload: {
                            source: 'vision',
                            itemCount: summaryItems.length,
                            itemIds: cappedItemIds,
                            items: summaryItems.slice(0, previewLimit),
                        },
                    });
                } catch (err) {
                    console.warn('[VisionPipeline] Event log failed', err?.message || err);
                }
            }

            const totalNeedsReview = lowConfidence.length + itemsToReview.length + skippedItems.length;
            console.log('[VisionPipeline] === processImage Complete (other) ===', { added: addedItems.length, needsReview: totalNeedsReview });

            return {
                analysis: { shelfConfirmed: true, items: allResolvedItems },
                results: { added: addedItems.length, needsReview: totalNeedsReview },
                addedItems,
                needsReview: [...lowConfidence, ...itemsToReview, ...skippedItems],
                warnings: warnings.length > 0 ? warnings : undefined,
            };
        }

        // ===== HIGH CONFIDENCE WORKFLOW (≥ max threshold) =====
        // Step 2: Fingerprint lookup for high confidence items
        checkAborted();
        updateProgress('matching', { count: highConfidence.length });
        console.log('[VisionPipeline] Step 2: Fingerprint lookup for', highConfidence.length, 'high-confidence items...');
        const matched = [];
        const unmatchedHigh = [];
        for (const item of highConfidence) {
            checkAborted();
            const collectable = await this.matchCollectable(item, shelf.type);
            if (collectable) {
                matched.push({ ...item, collectable, source: 'database-match' });
            } else {
                unmatchedHigh.push(item);
            }
        }
        console.log('[VisionPipeline] Step 2 Complete: Matched in DB:', matched.length, ', Unmatched high-conf:', unmatchedHigh.length);

        // Step 3: Catalog lookup for unmatched HIGH confidence items only
        checkAborted();
        updateProgress('catalog', { count: unmatchedHigh.length });
        let catalogResults = { resolved: [], unresolved: [] };
        if (unmatchedHigh.length > 0) {
            console.log('[VisionPipeline] Step 3: Catalog lookup for', unmatchedHigh.length, 'unmatched high-confidence items...');
            catalogResults = await this.lookupCatalog(unmatchedHigh, shelf.type);
            console.log('[VisionPipeline] Step 3 Complete: Catalog resolved:', catalogResults.resolved.length, ', Still unresolved:', catalogResults.unresolved.length);
        } else {
            console.log('[VisionPipeline] Step 3: Skipped - all high-confidence items matched in database');
        }

        // Step 4a: Standard enrichment for high-confidence items that failed both fingerprint AND catalog
        checkAborted();
        updateProgress('enriching', { count: catalogResults.unresolved.length });
        let enrichedHighConf = [];
        if (catalogResults.unresolved.length > 0) {
            console.log('[VisionPipeline] Step 4a: Standard enrichment for', catalogResults.unresolved.length, 'unresolved high-confidence items...');

            const rawOcrFingerprints = new Map();
            for (const item of catalogResults.unresolved) {
                const rawFp = makeVisionOcrFingerprint(
                    item.title || item.name,
                    item.author || item.primaryCreator || item.creator,
                    item.kind || item.type || shelfType,
                );
                if (rawFp) {
                    rawOcrFingerprints.set(item.title || item.name, rawFp);
                }
            }

            const enrichResult = await this.enrichUnresolved(catalogResults.unresolved, shelf.type);
            // Handle new format {items, warning} or legacy array format
            const enrichedArray = Array.isArray(enrichResult) ? enrichResult : enrichResult.items || [];
            if (enrichResult.warning) {
                warnings.push(enrichResult.warning);
            }
            enrichedHighConf = enrichedArray.map(enrichedItem => {
                const originalTitle = enrichedItem._originalTitle || enrichedItem.title || enrichedItem.name;
                const rawFp = rawOcrFingerprints.get(originalTitle);
                if (rawFp) {
                    return { ...enrichedItem, rawOcrFingerprint: rawFp };
                }
                return enrichedItem;
            });

            console.log('[VisionPipeline] Step 4a Complete: Enriched', enrichedHighConf.length, 'high-confidence items');
        }

        // ===== MEDIUM CONFIDENCE WORKFLOW (between min and max) =====
        // Skip catalog APIs, go directly to special enrichment
        checkAborted();
        updateProgress('enrichingMedium', { count: mediumConfidence.length });
        let enrichedMediumConf = [];
        if (mediumConfidence.length > 0) {
            console.log('[VisionPipeline] Step 4b: Special enrichment for', mediumConfidence.length, 'medium-confidence items (skipping catalog APIs)...');

            // First try fingerprint lookup (they might exist in DB)
            const mediumMatched = [];
            const mediumUnmatched = [];
            for (const item of mediumConfidence) {
                const collectable = await this.matchCollectable(item, shelf.type);
                if (collectable) {
                    mediumMatched.push({ ...item, collectable, source: 'database-match' });
                } else {
                    mediumUnmatched.push(item);
                }
            }
            console.log('[VisionPipeline] Step 4b: Medium-conf DB matches:', mediumMatched.length, ', Need enrichment:', mediumUnmatched.length);

            // Add DB matches to our matched list
            matched.push(...mediumMatched);

            // Special enrichment for medium confidence (no catalog, uncertain prompt)
            if (mediumUnmatched.length > 0) {
                const rawOcrFingerprints = new Map();
                for (const item of mediumUnmatched) {
                    const rawFp = makeVisionOcrFingerprint(
                        item.title || item.name,
                        item.author || item.primaryCreator || item.creator,
                        item.kind || item.type || shelfType,
                    );
                    if (rawFp) {
                        rawOcrFingerprints.set(item.title || item.name, rawFp);
                    }
                }

                // Use special uncertain prompt for medium confidence
                const enrichResult = await this.enrichUncertain(mediumUnmatched, shelf.type);
                // Handle new format {items, warning} or legacy array format
                const enrichedArray = Array.isArray(enrichResult) ? enrichResult : enrichResult.items || [];
                if (enrichResult.warning) {
                    warnings.push(enrichResult.warning);
                }
                enrichedMediumConf = enrichedArray.map(enrichedItem => {
                    const originalTitle = enrichedItem._originalTitle || enrichedItem.title || enrichedItem.name;
                    const rawFp = rawOcrFingerprints.get(originalTitle);
                    if (rawFp) {
                        return { ...enrichedItem, rawOcrFingerprint: rawFp };
                    }
                    return enrichedItem;
                });

                console.log('[VisionPipeline] Step 4b Complete: Special-enriched', enrichedMediumConf.length, 'medium-confidence items');
            }
        }

        // Step 5: Filter enriched items by confidence BEFORE saving
        // Only save items that meet the minimum threshold to shelf
        // Items below threshold go to review instead
        const allEnriched = [...enrichedHighConf, ...enrichedMediumConf];
        const { highConfidence: enrichedToSave, mediumConfidence: enrichedMedium, lowConfidence: enrichedToReview } = this.categorizeByConfidence(allEnriched, confidenceMax, confidenceMin);

        // Medium confidence enriched items should also be saved (they were already medium-tier input)
        const itemsToSave = [...enrichedToSave, ...enrichedMedium];
        const itemsToReview = enrichedToReview;

        console.log('[VisionPipeline] Step 5: Enriched items split:', {
            toSave: itemsToSave.length,
            toReview: itemsToReview.length
        });

        // Combine all items to save: DB matches + catalog matches + enriched items meeting threshold
        const allResolvedItems = [
            ...matched.map(m => ({ ...m, confidence: 1.0 })),
            ...catalogResults.resolved,
            ...itemsToSave
        ];
        console.log('[VisionPipeline] Step 5: Saving', allResolvedItems.length, 'resolved items to shelf...');
        checkAborted();
        updateProgress('saving', { count: allResolvedItems.length });
        const addedItems = await this.saveToShelf(allResolvedItems, userId, shelf.id, shelf.type);
        console.log('[VisionPipeline] Step 5 Complete: Added', addedItems.length, 'items to shelf');

        if (addedItems.length > 0) {
            const previewLimit = parseInt(process.env.FEED_AGGREGATE_PREVIEW_LIMIT || '5', 10);
            const summaryItems = addedItems.map((item) => ({
                itemId: item.itemId,
                collectableId: item.collectableId,
                title: item.title || item.name || null,
                primaryCreator: item.primaryCreator || item.author || null,
                coverUrl: item.coverUrl || null,
                type: item.type || item.kind || shelf.type,
            }));
            const itemIds = summaryItems.map((item) => item.itemId).filter(Boolean);
            const cappedItemIds = Number.isFinite(FEED_EVENT_ITEM_ID_CAP) && FEED_EVENT_ITEM_ID_CAP > 0
                ? itemIds.slice(0, FEED_EVENT_ITEM_ID_CAP)
                : itemIds;

            try {
                await feedQueries.logEvent({
                    userId,
                    shelfId: shelf.id,
                    eventType: 'item.collectable_added',
                    payload: {
                        source: 'vision',
                        itemCount: summaryItems.length,
                        itemIds: cappedItemIds,
                        items: summaryItems.slice(0, previewLimit),
                    },
                });
            } catch (err) {
                console.warn('[VisionPipeline] Event log failed', err?.message || err);
            }
        }

        // Send enriched items that didn't meet threshold to review queue
        if (itemsToReview.length > 0) {
            console.log('[VisionPipeline] Post-enrichment: Sending', itemsToReview.length, 'low-confidence enriched items to review queue...');
            await this.saveToReviewQueue(itemsToReview, userId, shelf.id);
        }

        const totalNeedsReview = lowConfidence.length + itemsToReview.length;
        console.log('[VisionPipeline] === processImage Complete ===', { added: addedItems.length, needsReview: totalNeedsReview });

        return {
            analysis: { shelfConfirmed: true, items: allResolvedItems },
            results: { added: addedItems.length, needsReview: totalNeedsReview },
            addedItems,
            needsReview: [...lowConfidence, ...itemsToReview],
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }

    async extractItems(imageBase64, shelfType, shelfDescription = null, shelfName = null) {
        // Gemini Vision Detect (Cloud Vision temporarily disabled)
        const detectionResult = await this.geminiService.detectShelfItemsFromImage(
            imageBase64,
            shelfType,
            shelfDescription,
            shelfName,
        );
        return detectionResult.items || [];
    }

    async lookupCatalog(items, shelfType) {
        console.log('[VisionPipeline.lookupCatalog] Starting catalog lookup for', items.length, 'items, shelfType:', shelfType);
        const catalogService = this.resolveCatalogServiceForShelf(shelfType);
        if (!catalogService) {
            console.log('[VisionPipeline.lookupCatalog] No catalog service available for shelfType:', shelfType);
            return { resolved: [], unresolved: items };
        }
        console.log('[VisionPipeline.lookupCatalog] Using catalog service:', catalogService.constructor.name);

        if (typeof catalogService.lookupFirstPass === 'function') {
            const resolved = [];
            const unresolved = [];
            try {
                console.log('[VisionPipeline.lookupCatalog] Calling lookupFirstPass (OpenLibrary -> Hardcover)...');
                const results = await catalogService.lookupFirstPass(items);
                const entries = Array.isArray(results) ? results : [];
                console.log('[VisionPipeline.lookupCatalog] lookupFirstPass returned', entries.length, 'entries');

                for (let index = 0; index < items.length; index++) {
                    const entry = entries[index];
                    const input = entry?.input || items[index];
                    const itemTitle = input?.title || input?.name || 'Unknown';
                    console.log(`[VisionPipeline.lookupCatalog] Processing item ${index + 1}/${items.length}:`, itemTitle, '- status:', entry?.status || 'no-entry');

                    if (entry && entry.status === 'resolved' && entry.enrichment) {
                        console.log('[VisionPipeline.lookupCatalog] ✓ Resolved via catalog:', itemTitle);
                        const lwf = makeLightweightFingerprint(input);
                        let collectable = null;
                        if (typeof catalogService.buildCollectablePayload === 'function') {
                            collectable = catalogService.buildCollectablePayload(entry, input, lwf);
                        }

                        if (collectable) {
                            resolved.push({
                                ...collectable,
                                kind: shelfType,
                                confidence: 1.0,
                                source: 'catalog-match',
                            });
                            continue;
                        }

                        const fallbackTitle = normalizeString(
                            entry.enrichment?.title || input?.title || input?.name,
                        );
                        if (fallbackTitle) {
                            resolved.push({
                                title: fallbackTitle,
                                primaryCreator:
                                    normalizeString(
                                        entry.enrichment?.primaryCreator ||
                                        entry.enrichment?.author ||
                                        input?.author ||
                                        input?.primaryCreator,
                                    ) || null,
                                year: entry.enrichment?.year || input?.year || null,
                                description: entry.enrichment?.description || input?.description || null,
                                kind: shelfType,
                                confidence: 0.9,
                                source: 'catalog-match',
                            });
                            continue;
                        }
                    }
                    if (input) {
                        console.log('[VisionPipeline.lookupCatalog] ✗ Unresolved, will try Gemini enrichment:', input?.title || input?.name);
                        unresolved.push(input);
                    }
                }
                console.log('[VisionPipeline.lookupCatalog] Summary: resolved:', resolved.length, 'unresolved:', unresolved.length);
                return { resolved, unresolved };
            } catch (err) {
                console.error('[VisionPipeline.lookupCatalog] lookupFirstPass failed:', err.message || err);
                return { resolved: [], unresolved: items };
            }
        }

        if (typeof catalogService.search !== 'function') {
            console.warn('[VisionPipelineService.lookupCatalog] catalog service missing lookup method');
            return { resolved: [], unresolved: items };
        }

        const resolved = [];
        const unresolved = [];

        for (const item of items) {
            try {
                const results = await catalogService.search(item.title || item.name);
                if (results && results.length > 0) {
                    const match = results[0];
                    resolved.push({
                        ...item,
                        title: match.title || item.title || item.name,
                        primaryCreator: match.authors ? match.authors.join(', ') : (match.developer || match.director || item.author || item.primaryCreator || null),
                        year: match.publishedDate ? match.publishedDate.substring(0, 4) : match.releaseDate,
                        confidence: 1.0,
                        source: 'catalog-match',
                        catalogId: match.id,
                        description: match.description,
                        image: match.imageLinks?.thumbnail || match.cover?.url,
                    });
                } else {
                    unresolved.push(item);
                }
            } catch (e) {
                console.error('Catalog lookup error', e);
                unresolved.push(item);
            }
        }

        return { resolved, unresolved };
    }

    async enrichUnresolved(items, shelfType) {
        if (!items.length) return [];
        // Use the new schema enforcement method
        return this.geminiService.enrichWithSchema(items, shelfType);
    }

    /**
     * Special enrichment for medium-confidence items.
     * Uses a prompt that emphasizes OCR uncertainty and asks for best-guess corrections.
     */
    async enrichUncertain(items, shelfType) {
        if (!items.length) return [];
        console.log('[VisionPipeline.enrichUncertain] Processing', items.length, 'uncertain items...');

        // Use enrichWithSchema but with an uncertain flag for special prompt handling
        if (typeof this.geminiService.enrichWithSchemaUncertain === 'function') {
            return this.geminiService.enrichWithSchemaUncertain(items, shelfType);
        }

        // Fallback to standard enrichment if specialized method not available
        console.log('[VisionPipeline.enrichUncertain] Falling back to standard enrichment (enrichWithSchemaUncertain not found)');
        return this.geminiService.enrichWithSchema(items, shelfType);
    }

    /**
     * Categorize items by confidence into three tiers:
     * - highConfidence (≥ max): catalog workflow
     * - mediumConfidence (≥ min, < max): special enrichment
     * - lowConfidence (< min): needs_review directly
     * @param {Array} items - Items to categorize
     * @param {number} maxThreshold - High confidence threshold (default from config/env)
     * @param {number} minThreshold - Medium confidence threshold (default from config/env)
     */
    categorizeByConfidence(items, maxThreshold = DEFAULT_CONFIDENCE_MAX, minThreshold = DEFAULT_CONFIDENCE_MIN) {
        const highConfidence = [];
        const mediumConfidence = [];
        const lowConfidence = [];

        items.forEach(item => {
            const conf = item.confidence ?? 0;
            if (conf >= maxThreshold) {
                highConfidence.push(item);
            } else if (conf >= minThreshold) {
                mediumConfidence.push(item);
            } else {
                lowConfidence.push(item);
            }
        });

        console.log('[VisionPipeline.categorizeByConfidence] Tiers:', {
            high: highConfidence.length,
            medium: mediumConfidence.length,
            low: lowConfidence.length,
            thresholds: { max: maxThreshold, min: minThreshold }
        });

        return { highConfidence, mediumConfidence, lowConfidence };
    }

    async matchCollectable(item, shelfType) {
        const itemTitle = item.title || item.name;
        console.log('[VisionPipeline.matchCollectable] Checking DB for:', itemTitle);

        // 1. Check by fingerprint (if present on item from catalog)
        if (item.fingerprint) {
            console.log('[VisionPipeline.matchCollectable] Checking fingerprint:', item.fingerprint);
            const byFp = await collectablesQueries.findByFingerprint(item.fingerprint);
            if (byFp) {
                console.log('[VisionPipeline.matchCollectable] ✓ Found via fingerprint:', byFp.id, byFp.title);
                return byFp;
            }
        }

        // 2. Lightweight fingerprint (title + creator hash)
        const lwf = makeLightweightFingerprint(item);
        console.log('[VisionPipeline.matchCollectable] Checking lightweight fingerprint:', lwf);
        let collectable = await collectablesQueries.findByLightweightFingerprint(lwf);

        if (collectable) {
            console.log('[VisionPipeline.matchCollectable] ✓ Found via lightweight fingerprint:', collectable.id, collectable.title);
            return collectable;
        }

        // 3. Fuzzy fingerprints array (raw OCR hashes stored from previous enrichments)
        if (collectablesQueries.findByFuzzyFingerprint) {
            const ocrFingerprint = makeVisionOcrFingerprint(
                itemTitle,
                item.author || item.primaryCreator || item.creator,
                item.kind || item.type || shelfType,
            );
            if (ocrFingerprint) {
                console.log('[VisionPipeline.matchCollectable] Checking fuzzy OCR fingerprint:', ocrFingerprint);
                collectable = await collectablesQueries.findByFuzzyFingerprint(ocrFingerprint);
                if (collectable) {
                    console.log('[VisionPipeline.matchCollectable] ✓ Found via fuzzy OCR fingerprint:', collectable.id, collectable.title);
                    return collectable;
                }
            }
            console.log('[VisionPipeline.matchCollectable] Checking legacy fuzzy fingerprints array:', lwf);
            collectable = await collectablesQueries.findByFuzzyFingerprint(lwf);
            if (collectable) {
                console.log('[VisionPipeline.matchCollectable] ✓ Found via legacy fuzzy fingerprint:', collectable.id, collectable.title);
                return collectable;
            }
        }

        console.log('[VisionPipeline.matchCollectable] ✗ No hash match found for:', itemTitle);
        return null;
    }

    async saveToShelf(items, userId, shelfId, shelfType) {
        console.log('[VisionPipeline.saveToShelf] Processing', items.length, 'items for shelf', shelfId);
        const added = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            console.log(`[VisionPipeline.saveToShelf] Item ${i + 1}/${items.length}:`, item.title || item.name);
            try {
                // Check if item already has a collectable from Step 2 (database match)
                let collectable = item.collectable || null;

                if (!collectable) {
                    // Only call matchCollectable if we don't already have one
                    collectable = await this.matchCollectable(item, shelfType);
                } else {
                    console.log('[VisionPipeline.saveToShelf] Using pre-matched collectable:', collectable.id, collectable.title);
                }

                if (!collectable) {
                    console.log('[VisionPipeline.saveToShelf] No existing collectable found, creating new entry...');
                    const title = normalizeString(item.title || item.name);
                    if (!title) {
                        console.warn('[VisionPipeline.saveToShelf] Skipping - missing title', { item });
                        continue;
                    }

                    const primaryCreator = normalizeString(
                        item.primaryCreator || item.author || item.creator,
                    );
                    const kind = normalizeString(item.kind || shelfType) || shelfType;
                    const year = normalizeString(item.year || item.releaseYear);
                    const publishers = normalizeStringArray(item.publishers, item.publisher);
                    const genre = normalizeStringArray(item.genre, item.genres);
                    const tags = normalizeStringArray(item.tags, item.genre, item.genres);
                    const runtimeValue = item.runtime ?? item.extras?.runtime;
                    const runtime = Number.isFinite(Number(runtimeValue)) ? Number(runtimeValue) : null;
                    const creators = normalizeStringArray(item.creators, primaryCreator);
                    const identifiers = normalizeIdentifiers(item.identifiers);
                    const images = normalizeArray(item.images);
                    const sources = normalizeArray(item.sources);
                    const systemName = normalizeString(
                        item.systemName ||
                        (Array.isArray(item.platforms) ? item.platforms[0] : item.platform),
                    );
                    // Collectable-level formats (VHS, DVD, 4K, etc.) - NOT user-specific
                    const itemFormat = normalizeString(item.format || item.physical?.format);
                    const formats = normalizeStringArray(item.formats, itemFormat);
                    const coverUrl = pickCoverUrl(
                        images,
                        normalizeString(
                            item.coverUrl ||
                            item.coverImage ||
                            item.image ||
                            item.urlCoverFront ||
                            item.urlCoverBack,
                        ),
                    );
                    const externalId = normalizeString(item.externalId || item.catalogId);

                    const fingerprint = item.fingerprint || makeCollectableFingerprint({
                        title,
                        primaryCreator: primaryCreator || null,
                        releaseYear: year || null,
                        mediaType: kind,
                        platforms: item.systemName ? [item.systemName] : item.platforms || item.platform,
                    });

                    const lightweightFingerprint = item.lightweightFingerprint || makeLightweightFingerprint({
                        title,
                        primaryCreator: primaryCreator || null,
                        kind,
                    });

                    collectable = await collectablesQueries.upsert({
                        fingerprint,
                        lightweightFingerprint,
                        kind,
                        title,
                        subtitle: normalizeString(item.subtitle) || null,
                        description: normalizeString(item.description) || null,
                        primaryCreator: primaryCreator || null,
                        creators,
                        publishers,
                        year: year || null,
                        formats,
                        systemName,
                        genre: genre.length ? genre : null,
                        runtime,
                        tags,
                        identifiers,
                        images,
                        coverUrl,
                        sources,
                        externalId: externalId || null,
                        // Include rawOcrFingerprint (from enrichment) in fuzzy fingerprints
                        fuzzyFingerprints: [
                            ...normalizeArray(item.fuzzyFingerprints),
                            ...(item.rawOcrFingerprint ? [item.rawOcrFingerprint] : [])
                        ].filter(Boolean),
                        // Provider-agnostic cover and attribution fields
                        coverImageUrl: item.coverImageUrl || null,
                        coverImageSource: item.coverImageSource || null,
                        attribution: item.attribution || null,
                    });
                    console.log('[VisionPipeline.saveToShelf] Created new collectable:', collectable.id, title);
                } else {
                    console.log('[VisionPipeline.saveToShelf] Using existing collectable:', collectable.id, collectable.title);
                }

                // Add to shelf - format is user-specific and should be set manually, not during scan
                console.log('[VisionPipeline.saveToShelf] Adding to shelf:', shelfId, 'collectable:', collectable.id);
                const shelfItem = await shelvesQueries.addCollectable({
                    userId,
                    shelfId,
                    collectableId: collectable.id,
                    // Note: format (user-specific) is intentionally not set during vision scan
                    // Users can set their preferred format later via manual edit
                });

                added.push({
                    ...item,
                    itemId: shelfItem?.id,
                    collectableId: collectable.id,
                    title: collectable.title || item.title || item.name || null,
                    primaryCreator: collectable.primaryCreator || item.primaryCreator || item.author || null,
                    coverUrl: collectable.coverUrl || item.coverUrl || item.coverImage || item.image || null,
                    type: collectable.kind || item.type || item.kind || shelfType,
                });
                console.log('[VisionPipeline.saveToShelf] ✓ Successfully added:', item.title || item.name);
            } catch (err) {
                console.error(`Failed to save item ${item.title}:`, err);
                // Fail safe: maybe add to review queue instead?
                // For now, just skip
            }
        }
        return added;
    }

    async saveManualToShelf(items, userId, shelfId, shelfType) {
        console.log('[VisionPipeline.saveManualToShelf] Processing', items.length, 'items for shelf', shelfId);
        const added = [];
        const matched = [];
        const skipped = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const title = normalizeString(item.title || item.name);
            const primaryCreator = normalizeString(
                item.primaryCreator || item.author || item.creator || item.brand || item.publisher || item.manufacturer,
            );
            if (!title || !primaryCreator) {
                console.warn('[VisionPipeline.saveManualToShelf] Missing title or primaryCreator, routing to review', { item });
                skipped.push(item);
                continue;
            }

            const manualFingerprint = item.manualFingerprint || makeManualFingerprint({
                title,
                primaryCreator,
                kind: shelfType,
            }, 'manual-other');

            if (manualFingerprint) {
                const existingManual = await shelvesQueries.findManualByFingerprint({
                    userId,
                    shelfId,
                    manualFingerprint,
                });
                if (existingManual) {
                    const existingCollection = await shelvesQueries.findManualCollection({
                        userId,
                        shelfId,
                        manualId: existingManual.id,
                    });
                    if (existingCollection) {
                        matched.push({
                            ...item,
                            itemId: existingCollection.id,
                            manualId: existingManual.id,
                            manual: existingManual,
                            title: existingManual.name || title,
                            primaryCreator: existingManual.author || primaryCreator,
                            type: shelfType,
                        });
                        continue;
                    }
                    const collection = await shelvesQueries.addManualCollection({
                        userId,
                        shelfId,
                        manualId: existingManual.id,
                    });
                    added.push({
                        ...item,
                        itemId: collection.id,
                        manualId: existingManual.id,
                        manual: existingManual,
                        title: existingManual.name || title,
                        primaryCreator: existingManual.author || primaryCreator,
                        type: shelfType,
                    });
                    continue;
                }
            }

            const payload = buildOtherManualPayload(item, shelfType, manualFingerprint);
            const result = await shelvesQueries.addManual({
                userId,
                shelfId,
                ...payload,
                tags: item.tags,
            });

            added.push({
                ...item,
                itemId: result.collection.id,
                manualId: result.manual.id,
                manual: result.manual,
                title: result.manual.name || title,
                primaryCreator: result.manual.author || primaryCreator,
                type: shelfType,
            });
        }

        return { added, matched, skipped };
    }

    async saveToReviewQueue(items, userId, shelfId) {
        if (!Array.isArray(items) || items.length === 0) {
            console.log('[VisionPipeline.saveToReviewQueue] No items to add to review queue');
            return;
        }
        if (!this.reviewQueueAvailable) {
            console.log('[VisionPipeline.saveToReviewQueue] Review queue not available, skipping');
            return;
        }

        console.log('[VisionPipeline.saveToReviewQueue] Adding', items.length, 'items to review queue');
        for (const item of items) {
            try {
                console.log('[VisionPipeline.saveToReviewQueue] Adding:', item.title || item.name, '(confidence:', item.confidence, ')');
                await needsReviewQueries.create({
                    userId,
                    shelfId,
                    rawData: item,
                    confidence: item.confidence
                });
            } catch (err) {
                if (isMissingRelationError(err, 'needs_review')) {
                    this.reviewQueueAvailable = false;
                    console.warn('[VisionPipelineService] needs_review table missing; skipping review queue.');
                    break;
                }
                throw err;
            }
        }
    }
}

module.exports = { VisionPipelineService };
