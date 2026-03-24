const { GoogleGeminiService, getVisionSettingsForType } = require('./googleGemini');
// const { GoogleCloudVisionService } = require('./googleCloudVision'); // Temporarily disabled; keep for easy re-enable.
const collectablesQueries = require('../database/queries/collectables');
const needsReviewQueries = require('../database/queries/needsReview');
const shelvesQueries = require('../database/queries/shelves');
const feedQueries = require('../database/queries/feed');
const visionItemRegionsQueries = require('../database/queries/visionItemRegions');
const { transaction } = require('../database/pg');
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
    dedupeOtherManualCandidates,
    evaluateOtherManualFuzzyCandidate,
    OTHER_MANUAL_FUZZY_REVIEW_MIN_THRESHOLD,
} = require('./manuals/otherManual');
const { HOOK_TYPES } = require('./visionPipelineHooks');
const {
    normalizeVisionDimension,
    normalizeVisionBox2d,
    isOutOfRangeBox2d,
    toNumericBox2d,
    normalizePixelPadding,
    expandVisionBox2dByPixels,
} = require('../utils/visionBox2d');

// Catalog Services
const { BookCatalogService } = require('./catalog/BookCatalogService');
const { GameCatalogService } = require('./catalog/GameCatalogService');
const { MovieCatalogService } = require('./catalog/MovieCatalogService');
const { MusicCatalogService } = require('./catalog/MusicCatalogService');
const logger = require('../logger');

// Load progress messages config
let progressMessagesConfig = {};
try {
    const configPath = path.join(__dirname, '..', 'config', 'visionProgressMessages.json');
    progressMessagesConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
    logger.warn('[VisionPipeline] Could not load visionProgressMessages.json, using defaults:', err.message);
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
// High confidence (≥ max): fingerprint → catalog → enrichment workflow
// Medium confidence (≥ min, < max): fingerprint → catalog → enrichment workflow (same as high)
// Low confidence (< min): needs_review directly
const DEFAULT_CONFIDENCE_MAX = parseFloat(process.env.VISION_CONFIDENCE_MAX || '0.92');
const DEFAULT_CONFIDENCE_MIN = parseFloat(process.env.VISION_CONFIDENCE_MIN || '0.85');
const FEED_EVENT_ITEM_ID_CAP = parseInt(process.env.FEED_EVENT_ITEM_ID_CAP || '250', 10);
const OTHER_SHELF_TYPE = 'other';
const DEFAULT_VISION_BBOX_PADDING_X_PX = 48;
const DEFAULT_VISION_BBOX_PADDING_Y_PX = 24;
const VISION_BBOX_PADDING_X_PX = normalizePixelPadding(
    process.env.VISION_BBOX_PADDING_X_PX,
    DEFAULT_VISION_BBOX_PADDING_X_PX,
);
const VISION_BBOX_PADDING_Y_PX = normalizePixelPadding(
    process.env.VISION_BBOX_PADDING_Y_PX,
    DEFAULT_VISION_BBOX_PADDING_Y_PX,
);

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

function normalizeExtractionIndex(value) {
    if (!Number.isInteger(value) || value < 0) return null;
    return value;
}

function hasValidBox2d(value) {
    const numeric = toNumericBox2d(value);
    if (!numeric) return false;
    const [yMin, xMin, yMax, xMax] = numeric;
    return yMax > yMin && xMax > xMin;
}

function normalizeBox2d(value, options = {}) {
    const imageWidth = options?.imageWidth ?? options?.width ?? null;
    const imageHeight = options?.imageHeight ?? options?.height ?? null;
    return normalizeVisionBox2d(value, { imageWidth, imageHeight });
}

function resolveScanDimensions(value) {
    if (!value || typeof value !== 'object') return null;
    const width = normalizeVisionDimension(value.width);
    const height = normalizeVisionDimension(value.height);
    if (!width || !height) return null;
    return { width, height };
}

function pickPreferredBox2d(item) {
    const parsedRaw = toNumericBox2d(item?.box_2d);
    const parsedNormalized = toNumericBox2d(item?.box2d);

    if (parsedRaw && isOutOfRangeBox2d(parsedRaw)) {
        return parsedRaw;
    }
    return parsedNormalized || parsedRaw || null;
}

function normalizeSourceLinks(value) {
    if (!value) return [];
    const source = Array.isArray(value) ? value : [value];
    return source
        .map((entry) => {
            if (!entry) return null;
            if (typeof entry === 'string') {
                const url = normalizeString(entry);
                return url ? { url } : null;
            }
            if (typeof entry === 'object') {
                const url = normalizeString(entry.url || entry.link || entry.href);
                if (!url) return null;
                const label = normalizeString(entry.label || entry.name || entry.title);
                return label ? { url, label } : { url };
            }
            return null;
        })
        .filter(Boolean);
}

function sanitizeSaveError(err) {
    return {
        code: normalizeString(err?.code) || null,
        message: normalizeString(err?.message) || 'Unknown save error',
        severity: normalizeString(err?.severity) || null,
    };
}

function buildGenericManualPayload(item, shelfType, manualFingerprint) {
    return {
        name: normalizeString(item?.title || item?.name) || null,
        author: normalizeString(
            item?.primaryCreator ||
            item?.author ||
            item?.creator ||
            item?.publisher ||
            item?.brand ||
            item?.manufacturer,
        ) || null,
        publisher: normalizeString(item?.publisher) || null,
        manufacturer: normalizeString(item?.manufacturer) || null,
        format: normalizeString(item?.format || item?.physical?.format) || null,
        type: normalizeString(shelfType || item?.type || item?.kind) || null,
        description: normalizeString(item?.description) || null,
        year: normalizeString(item?.year || item?.releaseYear) || null,
        marketValue: normalizeString(item?.marketValue || item?.market_value) || null,
        marketValueSources: normalizeSourceLinks(
            item?.marketValueSources || item?.market_value_sources || item?.marketSources,
        ),
        tags: normalizeStringArray(item?.tags, item?.genre, item?.genres),
        limitedEdition: normalizeString(item?.limitedEdition) || null,
        itemSpecificText: normalizeString(item?.itemSpecificText) || null,
        manualFingerprint: manualFingerprint || null,
    };
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
    if (err.code) return false;
    const message = String(err.message || err);
    if (!tableName) return false;
    return (
        message.includes(`relation "${tableName}" does not exist`)
        || message.includes(`relation '${tableName}' does not exist`)
    );
}

function isMissingColumnError(err, tableName, columnName) {
    if (!err) return false;
    if (err.code !== '42703') return false;
    const message = String(err.message || err);
    const hasTable = tableName ? message.includes(tableName) : true;
    const hasColumn = columnName ? message.includes(columnName) : true;
    return hasTable && hasColumn;
}

function mapEnrichedItemsToUnresolved(enrichedItems, unresolvedItems, unresolvedByIndex, unresolvedByTitle, rawOcrFingerprints) {
    const mapped = [];
    const seenSources = new Set();
    const allowPositionalFallback = enrichedItems.length <= unresolvedItems.length;
    let droppedCount = 0;

    for (let index = 0; index < enrichedItems.length; index++) {
        const enrichedItem = enrichedItems[index];
        const enrichedIndex = normalizeExtractionIndex(enrichedItem?.extractionIndex);
        const originalTitle = enrichedItem?._originalTitle || enrichedItem?.title || enrichedItem?.name || '';
        const titleKey = normalizeString(originalTitle).toLowerCase();

        let sourceItem = null;
        if (enrichedIndex != null) {
            sourceItem = unresolvedByIndex.get(enrichedIndex) || null;
        }
        if (!sourceItem && titleKey) {
            sourceItem = unresolvedByTitle.get(titleKey) || null;
        }
        if (!sourceItem && allowPositionalFallback) {
            sourceItem = unresolvedItems[index] || null;
        }
        if (!sourceItem && unresolvedItems.length === 1 && mapped.length === 0 && enrichedIndex == null) {
            sourceItem = unresolvedItems[0];
        }
        if (!sourceItem) {
            droppedCount += 1;
            continue;
        }

        const sourceIndex = normalizeExtractionIndex(sourceItem?.extractionIndex);
        const sourceTitle = sourceItem?.title || sourceItem?.name || '';
        const sourceTitleKey = normalizeString(sourceTitle).toLowerCase();
        const sourceKey = sourceIndex != null
            ? `idx:${sourceIndex}`
            : `title:${sourceTitleKey}`;
        if (seenSources.has(sourceKey)) {
            droppedCount += 1;
            continue;
        }
        seenSources.add(sourceKey);

        const inheritedBox2d = normalizeBox2d(sourceItem?.box2d ?? sourceItem?.box_2d);
        const normalizedEnrichedBox2d = normalizeBox2d(enrichedItem?.box2d ?? enrichedItem?.box_2d);
        const merged = {
            ...enrichedItem,
            extractionIndex: enrichedIndex ?? sourceIndex,
            box2d: normalizedEnrichedBox2d || inheritedBox2d || null,
        };
        const rawFp = rawOcrFingerprints.get(sourceTitle);
        mapped.push(rawFp ? { ...merged, rawOcrFingerprint: rawFp } : merged);
    }

    return { mapped, droppedCount };
}

function dedupeByExtractionIndex(items) {
    const deduped = [];
    const seen = new Set();
    let droppedCount = 0;

    for (const item of items) {
        const extractionIndex = normalizeExtractionIndex(item?.extractionIndex);
        if (extractionIndex == null) {
            deduped.push(item);
            continue;
        }
        if (seen.has(extractionIndex)) {
            droppedCount += 1;
            continue;
        }
        seen.add(extractionIndex);
        deduped.push(item);
    }

    return { deduped, droppedCount };
}

class VisionPipelineService {
    constructor(options = {}) {
        this.ocrEnabled = options.ocrEnabled ?? (process.env.VISION_OCR_ENABLED !== 'false');
        this.catalogEnabled = options.catalogEnabled ?? (process.env.VISION_CATALOG_ENABLED !== 'false');
        this.enrichmentEnabled = options.enrichmentEnabled ?? (process.env.VISION_ENRICHMENT_ENABLED !== 'false');
        this.geminiService = options.geminiService || new GoogleGeminiService();
        // this.visionService = new GoogleCloudVisionService();
        this.reviewQueueAvailable = true;
        this.collectionItemRegionLinkAvailable = true;
        this.hooks = options.hooks || null;

        // Initialize catalogs
        this.catalogs = options.catalogs || {
            book: new BookCatalogService(),
            game: new GameCatalogService(),
            movie: new MovieCatalogService(),
            music: new MusicCatalogService(),
        };
    }

    async executeHook(hookType, context) {
        if (!this.hooks) return;
        try {
            await this.hooks.execute(hookType, context);
        } catch (err) {
            logger.warn(`[VisionPipeline] Hook ${hookType} failed:`, err?.message || err);
        }
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
    async processImage(imageBase64, shelf, userId, jobId = null, options = null) {
        if (!shelf || !shelf.type) throw new Error('Invalid shelf provided');
        logger.info('[VisionPipeline] === Starting processImage ===', { shelfId: shelf.id, shelfType: shelf.type, userId, jobId });
        if (jobId && typeof jobId === 'object' && options == null) {
            options = jobId;
            jobId = null;
        }
        const resolvedOptions = options || {};
        const scanPhotoId = Number.isInteger(resolvedOptions.scanPhotoId)
            ? resolvedOptions.scanPhotoId
            : null;
        const scanPhotoDimensions = resolveScanDimensions(resolvedOptions.scanPhotoDimensions);

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
        const typeSettings = getVisionSettingsForType(shelf.type) || {};
        const confidenceMax = typeSettings.confidenceMax ?? DEFAULT_CONFIDENCE_MAX;
        const confidenceMin = typeSettings.confidenceMin ?? DEFAULT_CONFIDENCE_MIN;
        logger.info('[VisionPipeline] Using confidence thresholds for', shelf.type, ':', { max: confidenceMax, min: confidenceMin });

        const providedRawItems = Array.isArray(resolvedOptions.rawItems) ? resolvedOptions.rawItems : null;
        const ocrProvider = providedRawItems ? (resolvedOptions.ocrProvider || 'mlkit') : 'gemini';
        const baseHookContext = {
            jobId,
            userId,
            shelfId: shelf.id,
            shelfType: shelf.type,
            thresholds: { max: confidenceMax, min: confidenceMin },
            ocrProvider,
            scanPhotoId,
            scanPhotoDimensions,
        };

        // Step 1: Extract items from image
        checkAborted();
        updateProgress('extracting');
        logger.info('[VisionPipeline] Step 1: Extracting items from image via vision OCR...');
        let rawItems = [];
        let conversationHistory = null;
        if (providedRawItems) {
            rawItems = providedRawItems;
            // MLKit fallback: no Gemini extraction, so no conversation history
        } else if (this.ocrEnabled) {
            const extractResult = await this.extractItems(imageBase64, shelf.type, shelf.description, shelf.name);
            rawItems = extractResult.items;
            conversationHistory = extractResult.conversationHistory;
            if (extractResult.warning) warnings.push(extractResult.warning);
        } else {
            throw new Error('Vision OCR disabled and no rawItems provided');
        }
        logger.info('[VisionPipeline] Step 1 Complete: Extracted', rawItems.length, 'items:', rawItems.map(i => i.title || i.name));
        await this.executeHook(HOOK_TYPES.AFTER_VISION_OCR, {
            ...baseHookContext,
            items: rawItems,
            metadata: {
                imageSize: imageBase64 ? imageBase64.length : null,
                source: ocrProvider,
            },
        });
        const isOtherShelf = isOtherShelfType(shelf.type);
        let normalizedItems = (isOtherShelf
            ? rawItems.map(item => normalizeOtherManualItem(item, shelf.type))
            : rawItems
        ).map((item, index) => ({
            ...item,
            extractionIndex: normalizeExtractionIndex(item?.extractionIndex) ?? index,
            box2d: normalizeBox2d(pickPreferredBox2d(item), scanPhotoDimensions || {}),
        }));
        const extractedCount = normalizedItems.length;

        if (scanPhotoId) {
            await this.persistVisionRegions(
                normalizedItems,
                userId,
                shelf.id,
                scanPhotoId,
                scanPhotoDimensions || null,
            );
        }

        // Step 1b: Categorize into three tiers using per-type thresholds
        checkAborted();
        updateProgress('categorizing', { count: normalizedItems.length });
        logger.info('[VisionPipeline] Step 1b: Categorizing by confidence tiers...');
        let { highConfidence, mediumConfidence, lowConfidence } = this.categorizeByConfidence(
            normalizedItems,
            confidenceMax,
            confidenceMin,
        );
        await this.executeHook(HOOK_TYPES.AFTER_CONFIDENCE_CATEGORIZATION, {
            ...baseHookContext,
            highConfidence,
            mediumConfidence,
            lowConfidence,
        });

        const canRunOtherSecondPass = isOtherShelf
            && !providedRawItems
            && this.ocrEnabled
            && !!imageBase64
            && lowConfidence.length > 0;

        if (canRunOtherSecondPass) {
            checkAborted();
            updateProgress('extracting');
            logger.info('[VisionPipeline] Step 1c: Running other-shelf low-confidence second pass...', {
                firstPassLowConfidence: lowConfidence.length,
            });

            const secondPassResult = await this.extractItems(
                imageBase64,
                shelf.type,
                shelf.description,
                shelf.name,
                {
                    pass: 'second',
                    lowConfidenceItems: lowConfidence,
                    conversationHistory,
                },
            );
            conversationHistory = secondPassResult.conversationHistory || conversationHistory;
            if (secondPassResult.warning) warnings.push(secondPassResult.warning);

            const secondPassItems = (secondPassResult.items || []).map((item, index) => ({
                ...normalizeOtherManualItem(item, shelf.type),
                extractionIndex: normalizeExtractionIndex(item?.extractionIndex) ?? index,
                box2d: normalizeBox2d(pickPreferredBox2d(item), scanPhotoDimensions || {}),
            }));

            const lowConfidenceIndexes = new Set(
                lowConfidence
                    .map((item) => normalizeExtractionIndex(item?.extractionIndex))
                    .filter((value) => value != null),
            );
            const secondPassByIndex = new Map(
                secondPassItems
                    .map((item) => [normalizeExtractionIndex(item?.extractionIndex), item])
                    .filter(([value]) => value != null),
            );

            let replacementCount = 0;
            normalizedItems = normalizedItems.map((item) => {
                const extractionIndex = normalizeExtractionIndex(item?.extractionIndex);
                if (extractionIndex == null || !lowConfidenceIndexes.has(extractionIndex)) return item;
                const replacement = secondPassByIndex.get(extractionIndex);
                if (!replacement) return item;
                replacementCount += 1;
                const replacementConfidenceProvided = replacement?.confidenceProvided !== false;
                return {
                    ...item,
                    ...replacement,
                    extractionIndex,
                    confidence: replacementConfidenceProvided
                        ? replacement.confidence
                        : item.confidence,
                    // Keep first-pass regions stable for crop linkage; second pass is metadata-focused.
                    box2d: item.box2d ?? replacement.box2d ?? null,
                };
            });

            logger.info('[VisionPipeline] Other-shelf second pass merge complete', {
                firstPassLowConfidence: lowConfidence.length,
                secondPassItems: secondPassItems.length,
                replacedItems: replacementCount,
            });

            ({ highConfidence, mediumConfidence, lowConfidence } = this.categorizeByConfidence(
                normalizedItems,
                confidenceMax,
                confidenceMin,
            ));

            await this.executeHook(HOOK_TYPES.AFTER_CONFIDENCE_CATEGORIZATION, {
                ...baseHookContext,
                highConfidence,
                mediumConfidence,
                lowConfidence,
                metadata: { pass: 'second' },
            });

            if (scanPhotoId && replacementCount > 0) {
                await this.persistVisionRegions(
                    normalizedItems,
                    userId,
                    shelf.id,
                    scanPhotoId,
                    scanPhotoDimensions || null,
                );
            }
        }

        // Low confidence items go directly to needs_review.
        // For "other", this runs after the optional second pass recategorization.
        if (!isOtherShelf && lowConfidence.length > 0) {
            logger.info('[VisionPipeline] Sending', lowConfidence.length, 'low-confidence items (<' + confidenceMin + ') to review queue...');
            await this.saveToReviewQueue(lowConfidence, userId, shelf.id, {
                ...baseHookContext,
                reason: 'low_confidence',
            });
        }

        if (isOtherShelf) {
            if (lowConfidence.length > 0) {
                logger.info('[VisionPipeline] Sending', lowConfidence.length, 'low-confidence items (<' + confidenceMin + ') to review queue...');
                await this.saveToReviewQueue(lowConfidence, userId, shelf.id, {
                    ...baseHookContext,
                    reason: 'low_confidence',
                });
            }

            checkAborted();
            updateProgress('matching', { count: highConfidence.length });
            const candidates = [...highConfidence, ...mediumConfidence]
                .map((item) => ({
                    ...normalizeOtherManualItem(item, shelf.type),
                    extractionIndex: normalizeExtractionIndex(item?.extractionIndex),
                    box2d: normalizeBox2d(pickPreferredBox2d(item), scanPhotoDimensions || {}),
                }))
                .map((item) => ({
                    ...item,
                    manualFingerprint: item.manualFingerprint || makeManualFingerprint(
                        {
                            title: item.title || item.name,
                            primaryCreator: item.primaryCreator || item.author || item.creator,
                            kind: shelf.type,
                        },
                        'manual-other',
                    ),
                }));
            const { deduped: dedupedCandidates, droppedCount } = dedupeOtherManualCandidates(candidates);
            if (droppedCount > 0) {
                logger.info('[VisionPipeline] Dropped duplicate other-shelf candidates within scan batch', {
                    droppedCount,
                    originalCount: candidates.length,
                    dedupedCount: dedupedCandidates.length,
                });
            }

            const itemsToSave = [];
            const itemsToReview = [];

            for (const item of dedupedCandidates) {
                if (hasRequiredOtherFields(item)) {
                    itemsToSave.push(item);
                } else {
                    itemsToReview.push(item);
                }
            }

            if (itemsToReview.length > 0) {
                logger.info('[VisionPipeline] Sending', itemsToReview.length, 'incomplete items to review queue...');
                await this.saveToReviewQueue(itemsToReview, userId, shelf.id, {
                    ...baseHookContext,
                    reason: 'missing_fields',
                });
            }

            checkAborted();
            updateProgress('preparingOther', { count: itemsToSave.length });
            logger.info('[VisionPipeline] Saving', itemsToSave.length, 'other items to shelf...');
            updateProgress('saving', { count: itemsToSave.length });
            const manualResult = await this.saveManualToShelf(itemsToSave, userId, shelf.id, shelf.type, {
                requireCreator: true,
                hookContext: { ...baseHookContext, tier: 'other' },
            });
            const addedItems = manualResult.added || [];
            const matchedItems = manualResult.matched || [];
            const skippedItems = manualResult.skipped || [];
            const possibleDuplicateItems = manualResult.review || [];
            const allResolvedItems = [...addedItems, ...matchedItems];

            // Route skipped items (missing title or primaryCreator) to review queue
            if (skippedItems.length > 0) {
                logger.info('[VisionPipeline] Routing', skippedItems.length, 'skipped items (missing fields) to review queue...');
                await this.saveToReviewQueue(skippedItems, userId, shelf.id, {
                    ...baseHookContext,
                    reason: 'missing_fields',
                });
            }

            if (possibleDuplicateItems.length > 0) {
                logger.info('[VisionPipeline] Routing', possibleDuplicateItems.length, 'possible duplicates to review queue...');
                await this.saveToReviewQueue(possibleDuplicateItems, userId, shelf.id, {
                    ...baseHookContext,
                    reason: 'possible_duplicate',
                });
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
                    marketValue: item.marketValue || item.market_value || null,
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
                    logger.warn('[VisionPipeline] Event log failed', err?.message || err);
                }
            }

            const totalNeedsReview = lowConfidence.length + itemsToReview.length + skippedItems.length + possibleDuplicateItems.length;
            const existingItemsCount = matchedItems.length;
            logger.info('[VisionPipeline] === processImage Complete (other) ===', {
                extracted: extractedCount,
                added: addedItems.length,
                existing: existingItemsCount,
                needsReview: totalNeedsReview,
            });

            return {
                analysis: { shelfConfirmed: true, items: allResolvedItems },
                results: {
                    extracted: extractedCount,
                    added: addedItems.length,
                    existing: existingItemsCount,
                    needsReview: totalNeedsReview,
                },
                addedItems,
                needsReview: [...lowConfidence, ...itemsToReview, ...skippedItems, ...possibleDuplicateItems],
                warnings: warnings.length > 0 ? warnings : undefined,
            };
        }

        // ===== HIGH CONFIDENCE WORKFLOW (≥ max threshold) =====
        // Step 2: Fingerprint lookup for high confidence items
        checkAborted();
        updateProgress('matching', { count: highConfidence.length });
        logger.info('[VisionPipeline] Step 2: Fingerprint lookup for', highConfidence.length, 'high-confidence items...');
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
        logger.info('[VisionPipeline] Step 2 Complete: Matched in DB:', matched.length, ', Unmatched high-conf:', unmatchedHigh.length);
        await this.executeHook(HOOK_TYPES.AFTER_FINGERPRINT_LOOKUP, {
            ...baseHookContext,
            tier: 'high',
            matched,
            unmatched: unmatchedHigh,
            lookupStrategy: this.normalizeShelfType(shelf.type),
        });

        // Step 3: Catalog lookup for unmatched HIGH confidence items only
        checkAborted();
        updateProgress('catalog', { count: unmatchedHigh.length });
        let catalogResults = { resolved: [], unresolved: unmatchedHigh };
        if (unmatchedHigh.length > 0) {
            if (this.catalogEnabled) {
                logger.info('[VisionPipeline] Step 3: Catalog lookup for', unmatchedHigh.length, 'unmatched high-confidence items...');
                catalogResults = await this.lookupCatalog(unmatchedHigh, shelf.type);
                logger.info('[VisionPipeline] Step 3 Complete: Catalog resolved:', catalogResults.resolved.length, ', Still unresolved:', catalogResults.unresolved.length);
            } else {
                logger.info('[VisionPipeline] Step 3: Skipped - catalog lookup disabled');
            }
        } else {
            logger.info('[VisionPipeline] Step 3: Skipped - all high-confidence items matched in database');
        }
        await this.executeHook(HOOK_TYPES.AFTER_CATALOG_LOOKUP, {
            ...baseHookContext,
            resolved: catalogResults.resolved,
            unresolved: catalogResults.unresolved,
            skipped: !this.catalogEnabled || unmatchedHigh.length === 0,
        });

        // Step 4a: Standard enrichment for high-confidence items that failed both fingerprint AND catalog
        checkAborted();
        updateProgress('enriching', { count: catalogResults.unresolved.length });
        let enrichedHighConf = [];
        let unresolvedHighForReview = [];
        if (catalogResults.unresolved.length > 0) {
            if (this.enrichmentEnabled) {
                logger.info('[VisionPipeline] Step 4a: Standard enrichment for', catalogResults.unresolved.length, 'unresolved high-confidence items...');
                logger.info('[VisionPipeline] Enrichment stage request', {
                    stage: 'enrichment',
                    tier: 'high',
                    mode: Array.isArray(conversationHistory) && conversationHistory.length > 0
                        ? 'chat_continuation'
                        : 'standalone',
                });

                const rawOcrFingerprints = new Map();
                const unresolvedByTitle = new Map();
                const unresolvedByIndex = new Map();
                for (const item of catalogResults.unresolved) {
                    const rawFp = makeVisionOcrFingerprint(
                        item.title || item.name,
                        item.author || item.primaryCreator || item.creator,
                        item.kind || item.type || shelf.type,
                    );
                    if (rawFp) {
                        rawOcrFingerprints.set(item.title || item.name, rawFp);
                    }
                    const normalizedTitle = normalizeString(item.title || item.name).toLowerCase();
                    if (normalizedTitle && !unresolvedByTitle.has(normalizedTitle)) {
                        unresolvedByTitle.set(normalizedTitle, item);
                    }
                    const extractionIndex = normalizeExtractionIndex(item?.extractionIndex);
                    if (extractionIndex != null && !unresolvedByIndex.has(extractionIndex)) {
                        unresolvedByIndex.set(extractionIndex, item);
                    }
                }

                const enrichResult = await this.enrichUnresolved(catalogResults.unresolved, shelf.type, conversationHistory);
                // Handle new format {items, warning} or legacy array format
                const enrichedArray = Array.isArray(enrichResult) ? enrichResult : enrichResult.items || [];
                if (enrichResult.warning) {
                    warnings.push(enrichResult.warning);
                }
                const mappedHigh = mapEnrichedItemsToUnresolved(
                    enrichedArray,
                    catalogResults.unresolved,
                    unresolvedByIndex,
                    unresolvedByTitle,
                    rawOcrFingerprints,
                );
                enrichedHighConf = mappedHigh.mapped;
                if (mappedHigh.droppedCount > 0) {
                    logger.warn('[VisionPipeline] Step 4a dropped enrichment items that did not map to unresolved high-confidence entries', {
                        droppedCount: mappedHigh.droppedCount,
                        unresolvedCount: catalogResults.unresolved.length,
                        enrichedCount: enrichedArray.length,
                    });
                }

                logger.info('[VisionPipeline] Step 4a Complete: Enriched', enrichedHighConf.length, 'high-confidence items');
                await this.executeHook(HOOK_TYPES.AFTER_GEMINI_ENRICHMENT, {
                    ...baseHookContext,
                    enrichedItems: enrichedHighConf,
                    warnings: warnings.length > 0 ? warnings : undefined,
                    mode: 'standard',
                    skipped: false,
                });
            } else {
                logger.info('[VisionPipeline] Step 4a: Skipped - enrichment disabled');
                unresolvedHighForReview = catalogResults.unresolved;
                await this.executeHook(HOOK_TYPES.AFTER_GEMINI_ENRICHMENT, {
                    ...baseHookContext,
                    enrichedItems: [],
                    warnings: warnings.length > 0 ? warnings : undefined,
                    mode: 'standard',
                    skipped: true,
                });
            }
        }

        // ===== MEDIUM CONFIDENCE WORKFLOW (between min and max) =====
        // Fingerprint lookup, then catalog, then enrichment for unmatched
        checkAborted();
        updateProgress('matching', { count: mediumConfidence.length });
        const mediumMatched = [];
        const mediumUnmatched = [];
        if (mediumConfidence.length > 0) {
            logger.info('[VisionPipeline] Step 4b: Medium-confidence matching (fingerprint first)...');
            for (const item of mediumConfidence) {
                const collectable = await this.matchCollectable(item, shelf.type);
                if (collectable) {
                    mediumMatched.push({ ...item, collectable, source: 'database-match' });
                } else {
                    mediumUnmatched.push(item);
                }
            }
            logger.info('[VisionPipeline] Step 4b: Medium-conf DB matches:', mediumMatched.length, ', Unmatched:', mediumUnmatched.length);

            // Add DB matches to our matched list
            matched.push(...mediumMatched);
        }
        await this.executeHook(HOOK_TYPES.AFTER_FINGERPRINT_LOOKUP, {
            ...baseHookContext,
            tier: 'medium',
            matched: mediumMatched,
            unmatched: mediumUnmatched,
            lookupStrategy: this.normalizeShelfType(shelf.type),
        });

        // Step 4c: Catalog lookup for medium-confidence unmatched items
        checkAborted();
        let mediumCatalogResults = { resolved: [], unresolved: mediumUnmatched };
        if (mediumUnmatched.length > 0) {
            if (this.catalogEnabled) {
                updateProgress('catalog', { count: mediumUnmatched.length });
                logger.info('[VisionPipeline] Step 4c: Catalog lookup for', mediumUnmatched.length, 'medium-confidence items...');
                mediumCatalogResults = await this.lookupCatalog(mediumUnmatched, shelf.type);
                logger.info('[VisionPipeline] Step 4c Complete: Catalog resolved:', mediumCatalogResults.resolved.length, ', Still unresolved:', mediumCatalogResults.unresolved.length);
            } else {
                logger.info('[VisionPipeline] Step 4c: Skipped - catalog lookup disabled');
            }
        } else {
            logger.info('[VisionPipeline] Step 4c: Skipped - all medium-confidence items matched in database');
        }
        await this.executeHook(HOOK_TYPES.AFTER_CATALOG_LOOKUP, {
            ...baseHookContext,
            tier: 'medium',
            resolved: mediumCatalogResults.resolved,
            unresolved: mediumCatalogResults.unresolved,
            skipped: !this.catalogEnabled || mediumUnmatched.length === 0,
        });

        // Step 4d: Enrichment for medium-confidence items that failed both fingerprint AND catalog
        checkAborted();
        let enrichedMediumConf = [];
        let unresolvedMediumForManual = [];
        if (mediumCatalogResults.unresolved.length > 0) {
            if (this.enrichmentEnabled) {
                updateProgress('enriching', { count: mediumCatalogResults.unresolved.length });
                logger.info('[VisionPipeline] Step 4d: Enrichment for', mediumCatalogResults.unresolved.length, 'unresolved medium-confidence items...');
                logger.info('[VisionPipeline] Enrichment stage request', {
                    stage: 'enrichment',
                    tier: 'medium',
                    mode: Array.isArray(conversationHistory) && conversationHistory.length > 0
                        ? 'chat_continuation'
                        : 'standalone',
                });

                const rawOcrFingerprints = new Map();
                const unresolvedByTitle = new Map();
                const unresolvedByIndex = new Map();
                for (const item of mediumCatalogResults.unresolved) {
                    const rawFp = makeVisionOcrFingerprint(
                        item.title || item.name,
                        item.author || item.primaryCreator || item.creator,
                        item.kind || item.type || shelf.type,
                    );
                    if (rawFp) {
                        rawOcrFingerprints.set(item.title || item.name, rawFp);
                    }
                    const normalizedTitle = normalizeString(item.title || item.name).toLowerCase();
                    if (normalizedTitle && !unresolvedByTitle.has(normalizedTitle)) {
                        unresolvedByTitle.set(normalizedTitle, item);
                    }
                    const extractionIndex = normalizeExtractionIndex(item?.extractionIndex);
                    if (extractionIndex != null && !unresolvedByIndex.has(extractionIndex)) {
                        unresolvedByIndex.set(extractionIndex, item);
                    }
                }

                // Use enrichUncertain for medium-confidence items if available
                const enrichResult = typeof this.geminiService.enrichWithSchemaUncertain === 'function'
                    ? await this.enrichUncertain(mediumCatalogResults.unresolved, shelf.type, conversationHistory)
                    : await this.enrichUnresolved(mediumCatalogResults.unresolved, shelf.type, conversationHistory);

                const enrichedArray = Array.isArray(enrichResult) ? enrichResult : enrichResult.items || [];
                if (enrichResult.warning) {
                    warnings.push(enrichResult.warning);
                }
                const mappedMedium = mapEnrichedItemsToUnresolved(
                    enrichedArray,
                    mediumCatalogResults.unresolved,
                    unresolvedByIndex,
                    unresolvedByTitle,
                    rawOcrFingerprints,
                );
                enrichedMediumConf = mappedMedium.mapped;
                if (mappedMedium.droppedCount > 0) {
                    logger.warn('[VisionPipeline] Step 4d dropped enrichment items that did not map to unresolved medium-confidence entries', {
                        droppedCount: mappedMedium.droppedCount,
                        unresolvedCount: mediumCatalogResults.unresolved.length,
                        enrichedCount: enrichedArray.length,
                    });
                }

                logger.info('[VisionPipeline] Step 4d Complete: Enriched', enrichedMediumConf.length, 'medium-confidence items');
                await this.executeHook(HOOK_TYPES.AFTER_GEMINI_ENRICHMENT, {
                    ...baseHookContext,
                    enrichedItems: enrichedMediumConf,
                    warnings: warnings.length > 0 ? warnings : undefined,
                    mode: 'uncertain',
                    tier: 'medium',
                    skipped: false,
                });
            } else {
                logger.info('[VisionPipeline] Step 4d: Skipped - enrichment disabled');
                unresolvedMediumForManual = mediumCatalogResults.unresolved;
                await this.executeHook(HOOK_TYPES.AFTER_GEMINI_ENRICHMENT, {
                    ...baseHookContext,
                    enrichedItems: [],
                    warnings: warnings.length > 0 ? warnings : undefined,
                    mode: 'uncertain',
                    tier: 'medium',
                    skipped: true,
                });
            }
        }

        // Filter enriched medium-confidence items by confidence before deciding save vs manual
        const {
            highConfidence: enrichedMediumToSave,
            mediumConfidence: enrichedMediumMid,
            lowConfidence: enrichedMediumToManual
        } = this.categorizeByConfidence(enrichedMediumConf, confidenceMax, confidenceMin);

        // Medium+ enriched items can be saved as collectables
        const mediumItemsToSaveRaw = [...mediumCatalogResults.resolved, ...enrichedMediumToSave, ...enrichedMediumMid];
        const mediumItemsToSaveResult = dedupeByExtractionIndex(mediumItemsToSaveRaw);
        const mediumItemsToSave = mediumItemsToSaveResult.deduped;
        // Low confidence enriched items and unresolved items go to manual
        const mediumItemsToManual = [...enrichedMediumToManual, ...unresolvedMediumForManual];

        logger.info('[VisionPipeline] Step 4d: Medium-conf items split:', {
            toSaveAsCollectable: mediumItemsToSave.length,
            toSaveAsManual: mediumItemsToManual.length,
            dedupedSaveEntries: mediumItemsToSaveResult.droppedCount,
        });

        // Save resolved medium-confidence items as collectables
        let mediumAddedCollectables = [];
        let mediumSaveFailures = [];
        if (mediumItemsToSave.length > 0) {
            checkAborted();
            updateProgress('saving', { count: mediumItemsToSave.length });
            const mediumSaveResult = await this.saveToShelf(
                mediumItemsToSave,
                userId,
                shelf.id,
                shelf.type,
                { ...baseHookContext, tier: 'medium' },
            );
            mediumAddedCollectables = mediumSaveResult.added || [];
            mediumSaveFailures = mediumSaveResult.failed || [];
            logger.info('[VisionPipeline] Saved', mediumAddedCollectables.length, 'medium-confidence items as collectables');
        }

        let manualAdded = [];
        let manualMatched = [];
        let manualSkipped = [];
        if (mediumItemsToManual.length > 0) {
            checkAborted();
            updateProgress('saving', { count: mediumItemsToManual.length });
            const manualResult = await this.saveManualToShelf(mediumItemsToManual, userId, shelf.id, shelf.type, {
                requireCreator: false,
                hookContext: { ...baseHookContext, tier: 'medium' },
            });
            manualAdded = manualResult.added || [];
            manualMatched = manualResult.matched || [];
            manualSkipped = manualResult.skipped || [];

            if (manualSkipped.length > 0) {
                logger.info('[VisionPipeline] Routing', manualSkipped.length, 'medium-conf items (missing fields) to review queue...');
                await this.saveToReviewQueue(manualSkipped, userId, shelf.id, {
                    ...baseHookContext,
                    reason: 'missing_fields',
                });
            }

            if (manualAdded.length > 0) {
                const previewLimit = parseInt(process.env.FEED_AGGREGATE_PREVIEW_LIMIT || '5', 10);
                const summaryItems = manualAdded.map((item) => ({
                    itemId: item.itemId,
                    manualId: item.manualId,
                    name: item.title || item.name || null,
                    author: item.primaryCreator || item.author || null,
                    year: item.year || null,
                    type: item.type || shelf.type,
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
                    logger.warn('[VisionPipeline] Event log failed', err?.message || err);
                }
            }
        }

        // Step 5: Filter enriched items by confidence BEFORE saving
        // Only save items that meet the minimum threshold to shelf
        // Items below threshold go to review instead
        const { highConfidence: enrichedToSave, mediumConfidence: enrichedMedium, lowConfidence: enrichedToReview } = this.categorizeByConfidence(
            enrichedHighConf,
            confidenceMax,
            confidenceMin,
        );

        // Medium confidence enriched items should also be saved (they were already high-tier input)
        const itemsToSave = [...enrichedToSave, ...enrichedMedium];
        const itemsToReview = enrichedToReview;

        logger.info('[VisionPipeline] Step 5: Enriched items split:', {
            toSave: itemsToSave.length,
            toReview: itemsToReview.length
        });

        // Combine all items to save: DB matches + catalog matches + enriched items meeting threshold
        const collectableResolvedItemsRaw = [
            ...matched.map(m => ({ ...m, confidence: 1.0 })),
            ...catalogResults.resolved,
            ...itemsToSave
        ];
        const collectableResolvedItemsResult = dedupeByExtractionIndex(collectableResolvedItemsRaw);
        const collectableResolvedItems = collectableResolvedItemsResult.deduped;
        logger.info('[VisionPipeline] Step 5: Saving', collectableResolvedItems.length, 'resolved items to shelf...');
        if (collectableResolvedItemsResult.droppedCount > 0) {
            logger.warn('[VisionPipeline] Step 5 dropped duplicate resolved entries by extractionIndex', {
                droppedCount: collectableResolvedItemsResult.droppedCount,
            });
        }
        checkAborted();
        updateProgress('saving', { count: collectableResolvedItems.length });
        const collectableSaveResult = await this.saveToShelf(
            collectableResolvedItems,
            userId,
            shelf.id,
            shelf.type,
            baseHookContext,
        );
        const addedCollectables = collectableSaveResult.added || [];
        const saveFailedItems = [...mediumSaveFailures, ...(collectableSaveResult.failed || [])];
        const addedItems = [...addedCollectables, ...mediumAddedCollectables, ...manualAdded];
        logger.info('[VisionPipeline] Step 5 Complete: Save summary', {
            added: addedItems.length,
            failedToReview: saveFailedItems.length,
        });

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
                logger.warn('[VisionPipeline] Event log failed', err?.message || err);
            }
        }

        const reviewQueueItems = [...lowConfidence, ...manualSkipped, ...itemsToReview, ...unresolvedHighForReview, ...saveFailedItems];

        // Send enriched items that didn't meet threshold to review queue
        if (itemsToReview.length > 0) {
            logger.info('[VisionPipeline] Post-enrichment: Sending', itemsToReview.length, 'low-confidence enriched items to review queue...');
            await this.saveToReviewQueue(itemsToReview, userId, shelf.id, {
                ...baseHookContext,
                reason: 'post_enrichment',
            });
        }

        if (unresolvedHighForReview.length > 0) {
            logger.info('[VisionPipeline] Post-catalog: Sending', unresolvedHighForReview.length, 'unresolved items to review queue...');
            await this.saveToReviewQueue(unresolvedHighForReview, userId, shelf.id, {
                ...baseHookContext,
                reason: 'enrichment_disabled',
            });
        }

        const totalNeedsReview = reviewQueueItems.length;
        const existingItemsCount = manualMatched.length;
        logger.info('[VisionPipeline] === processImage Complete ===', {
            extracted: extractedCount,
            added: addedItems.length,
            existing: existingItemsCount,
            needsReview: totalNeedsReview,
            saveFailedToReview: saveFailedItems.length,
        });

        return {
            analysis: { shelfConfirmed: true, items: [...collectableResolvedItems, ...manualAdded, ...manualMatched] },
            results: {
                extracted: extractedCount,
                added: addedItems.length,
                existing: existingItemsCount,
                needsReview: totalNeedsReview,
            },
            addedItems,
            needsReview: reviewQueueItems,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }

    async persistVisionRegions(items, userId, shelfId, scanPhotoId, scanPhotoDimensions = null) {
        if (!scanPhotoId || !Array.isArray(items)) return;
        const resolvedDimensions = resolveScanDimensions(scanPhotoDimensions);
        let repairedBoxes = 0;
        let rejectedBoxes = 0;
        let paddedBoxes = 0;
        const regions = items
            .map((item) => {
                const preferredBox2d = pickPreferredBox2d(item);
                const normalizedBox2d = normalizeBox2d(preferredBox2d, resolvedDimensions || {});
                if (normalizedBox2d && resolvedDimensions && isOutOfRangeBox2d(preferredBox2d)) {
                    repairedBoxes += 1;
                }
                let box2d = normalizedBox2d;
                if (box2d && resolvedDimensions) {
                    const padded = expandVisionBox2dByPixels(box2d, {
                        imageWidth: resolvedDimensions.width,
                        imageHeight: resolvedDimensions.height,
                        paddingXPx: VISION_BBOX_PADDING_X_PX,
                        paddingYPx: VISION_BBOX_PADDING_Y_PX,
                    });
                    if (padded) {
                        const changed = padded.some((value, index) => value !== box2d[index]);
                        if (changed) paddedBoxes += 1;
                        box2d = padded;
                    }
                }
                if (!box2d) {
                    rejectedBoxes += 1;
                }
                return {
                    extractionIndex: normalizeExtractionIndex(item?.extractionIndex),
                    title: item?.title || item?.name || null,
                    primaryCreator: item?.primaryCreator || item?.author || item?.creator || null,
                    box2d,
                    confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : null,
                };
            })
            .filter((item) => item.extractionIndex != null && hasValidBox2d(item.box2d));

        if (repairedBoxes > 0 || rejectedBoxes > 0 || paddedBoxes > 0) {
            logger.info('[VisionPipeline.persistVisionRegions] BBox normalization summary', {
                shelfId,
                scanPhotoId,
                repaired: repairedBoxes,
                padded: paddedBoxes,
                rejected: rejectedBoxes,
                inputCount: items.length,
                persistedCount: regions.length,
                usedScanDimensions: !!resolvedDimensions,
                paddingPx: {
                    x: VISION_BBOX_PADDING_X_PX,
                    y: VISION_BBOX_PADDING_Y_PX,
                },
            });
        }

        try {
            await visionItemRegionsQueries.upsertRegionsForScan({
                userId,
                shelfId,
                scanPhotoId,
                regions,
                replaceExisting: true,
            });
        } catch (err) {
            if (isMissingRelationError(err, 'vision_item_regions')) {
                logger.warn('[VisionPipeline] vision_item_regions table missing; skipping region persistence.');
                return;
            }
            throw err;
        }
    }

    async linkRegionToCollectable(item, collectableId, hookContext = {}) {
        const scanPhotoId = hookContext?.scanPhotoId;
        const extractionIndex = normalizeExtractionIndex(item?.extractionIndex);
        if (!scanPhotoId || extractionIndex == null || !collectableId) return;

        try {
            await visionItemRegionsQueries.linkCollectable({
                scanPhotoId,
                extractionIndex,
                collectableId,
            });
        } catch (err) {
            if (isMissingRelationError(err, 'vision_item_regions')) {
                logger.warn('[VisionPipeline] vision_item_regions table missing; skipping collectable region link.');
                return;
            }
            throw err;
        }
    }

    async linkRegionToManual(item, manualId, hookContext = {}) {
        const scanPhotoId = hookContext?.scanPhotoId;
        const extractionIndex = normalizeExtractionIndex(item?.extractionIndex);
        if (!scanPhotoId || extractionIndex == null || !manualId) return;

        try {
            await visionItemRegionsQueries.linkManual({
                scanPhotoId,
                extractionIndex,
                manualId,
            });
        } catch (err) {
            if (isMissingRelationError(err, 'vision_item_regions')) {
                logger.warn('[VisionPipeline] vision_item_regions table missing; skipping manual region link.');
                return;
            }
            throw err;
        }
    }

    async linkRegionToCollectionItem(item, collectionItemId, hookContext = {}) {
        if (!this.collectionItemRegionLinkAvailable) return;
        const scanPhotoId = hookContext?.scanPhotoId;
        const extractionIndex = normalizeExtractionIndex(item?.extractionIndex);
        if (!scanPhotoId || extractionIndex == null || !collectionItemId) return;

        try {
            await visionItemRegionsQueries.linkCollectionItem({
                scanPhotoId,
                extractionIndex,
                collectionItemId,
            });
        } catch (err) {
            if (isMissingRelationError(err, 'vision_item_regions')) {
                this.collectionItemRegionLinkAvailable = false;
                logger.warn('[VisionPipeline] vision_item_regions table missing; skipping collection item region link.');
                return;
            }
            if (isMissingColumnError(err, 'vision_item_regions', 'collection_item_id')) {
                this.collectionItemRegionLinkAvailable = false;
                logger.warn('[VisionPipeline] vision_item_regions.collection_item_id missing; skipping collection item region link.');
                return;
            }
            throw err;
        }
    }

    async extractItems(imageBase64, shelfType, shelfDescription = null, shelfName = null, options = null) {
        const pass = options?.pass === 'second' ? 'second' : 'first';
        logger.info('[VisionPipeline] OCR extraction stage request', {
            stage: 'ocr_extraction',
            shelfType,
            pass,
        });
        // Gemini Vision Detect (Cloud Vision temporarily disabled)
        const detectionResult = await this.geminiService.detectShelfItemsFromImage(
            imageBase64,
            shelfType,
            shelfDescription,
            shelfName,
            options,
        );
        return {
            items: detectionResult.items || [],
            conversationHistory: detectionResult.conversationHistory || null,
            warning: detectionResult.warning || null,
        };
    }

    async lookupCatalog(items, shelfType) {
        logger.info('[VisionPipeline.lookupCatalog] Starting catalog lookup for', items.length, 'items, shelfType:', shelfType);
        const catalogService = this.resolveCatalogServiceForShelf(shelfType);
        if (!catalogService) {
            logger.info('[VisionPipeline.lookupCatalog] No catalog service available for shelfType:', shelfType);
            return { resolved: [], unresolved: items };
        }
        logger.info('[VisionPipeline.lookupCatalog] Using catalog service:', catalogService.constructor.name);

        if (typeof catalogService.lookupFirstPass === 'function') {
            const resolved = [];
            const unresolved = [];
            try {
                logger.info('[VisionPipeline.lookupCatalog] Calling lookupFirstPass (OpenLibrary -> Hardcover)...');
                const results = await catalogService.lookupFirstPass(items);
                const entries = Array.isArray(results) ? results : [];
                logger.info('[VisionPipeline.lookupCatalog] lookupFirstPass returned', entries.length, 'entries');

                for (let index = 0; index < items.length; index++) {
                    const entry = entries[index];
                    const input = entry?.input || items[index];
                    const itemTitle = input?.title || input?.name || 'Unknown';
                    logger.info(`[VisionPipeline.lookupCatalog] Processing item ${index + 1}/${items.length}:`, itemTitle, '- status:', entry?.status || 'no-entry');

                    if (entry && entry.status === 'resolved' && entry.enrichment) {
                        logger.info('[VisionPipeline.lookupCatalog] ✓ Resolved via catalog:', itemTitle);
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
                                extractionIndex: input?.extractionIndex ?? null,
                                box2d: normalizeBox2d(input?.box2d ?? input?.box_2d),
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
                                extractionIndex: input?.extractionIndex ?? null,
                                box2d: normalizeBox2d(input?.box2d ?? input?.box_2d),
                            });
                            continue;
                        }
                    }
                    if (input) {
                        logger.info('[VisionPipeline.lookupCatalog] ✗ Unresolved, will try Gemini enrichment:', input?.title || input?.name);
                        unresolved.push(input);
                    }
                }
                logger.info('[VisionPipeline.lookupCatalog] Summary: resolved:', resolved.length, 'unresolved:', unresolved.length);
                return { resolved, unresolved };
            } catch (err) {
                logger.error('[VisionPipeline.lookupCatalog] lookupFirstPass failed:', err.message || err);
                return { resolved: [], unresolved: items };
            }
        }

        if (typeof catalogService.search !== 'function') {
            logger.warn('[VisionPipelineService.lookupCatalog] catalog service missing lookup method');
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
                logger.error('Catalog lookup error', e);
                unresolved.push(item);
            }
        }

        return { resolved, unresolved };
    }

    async enrichUnresolved(items, shelfType, conversationHistory = null) {
        if (!items.length) return [];
        // Use the new schema enforcement method, with conversation history for chat context
        return this.geminiService.enrichWithSchema(items, shelfType, conversationHistory);
    }

    /**
     * Special enrichment for medium-confidence items.
     * Uses a prompt that emphasizes OCR uncertainty and asks for best-guess corrections.
     */
    async enrichUncertain(items, shelfType, conversationHistory = null) {
        if (!items.length) return [];
        logger.info('[VisionPipeline.enrichUncertain] Processing', items.length, 'uncertain items...');

        // Use enrichWithSchema but with an uncertain flag for special prompt handling
        if (typeof this.geminiService.enrichWithSchemaUncertain === 'function') {
            return this.geminiService.enrichWithSchemaUncertain(items, shelfType, conversationHistory);
        }

        // Fallback to standard enrichment if specialized method not available
        logger.info('[VisionPipeline.enrichUncertain] Falling back to standard enrichment (enrichWithSchemaUncertain not found)');
        return this.geminiService.enrichWithSchema(items, shelfType, conversationHistory);
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

        logger.info('[VisionPipeline.categorizeByConfidence] Tiers:', {
            high: highConfidence.length,
            medium: mediumConfidence.length,
            low: lowConfidence.length,
            thresholds: { max: maxThreshold, min: minThreshold }
        });

        return { highConfidence, mediumConfidence, lowConfidence };
    }

    /**
     * Normalize shelf type to canonical form.
     * Maps singular to plural and handles common aliases.
     * @param {string} shelfType - Raw shelf type
     * @returns {string} Normalized shelf type
     */
    normalizeShelfType(shelfType) {
        const normalized = String(shelfType || '').toLowerCase().trim();
        const mappings = {
            'book': 'books',
            'movie': 'movies',
            'film': 'movies',
            'game': 'games',
            'television': 'tv',
            'series': 'tv',
            'show': 'tv',
        };
        return mappings[normalized] || normalized;
    }

    /**
     * Perform shelf-type-specific secondary lookup.
     * Movies/TV use name search (director not visible on spine).
     * Books/games use fuzzy fingerprint (creator usually visible).
     * @param {object} item - Item to look up
     * @param {string} shelfType - Shelf type
     * @param {string} lwf - Lightweight fingerprint
     * @returns {Promise<object|null>} Matching collectable or null
     */
    async shelfTypeSecondaryLookup(item, shelfType, lwf) {
        const itemTitle = item.title || item.name;
        const normalizedType = this.normalizeShelfType(shelfType);

        switch (normalizedType) {
            case 'movies':
            case 'tv':
                // Name search only (director not visible on spine)
                // Get threshold from visionSettings.json if available
                const typeSettings = getVisionSettingsForType(shelfType) || {};
                const threshold = typeSettings.nameSearchThreshold ?? 0.4;
                logger.info('[VisionPipeline.matchCollectable] Using name search for', normalizedType, '(threshold:', threshold, ')');
                return collectablesQueries.findByNameSearch(itemTitle, normalizedType, threshold);

            case 'books':
            case 'games':
            default:
                // Fuzzy fingerprint lookup (creator usually visible)
                return this.fuzzyFingerprintLookup(item, shelfType, lwf);
        }
    }

    /**
     * Perform fuzzy fingerprint lookup for items where creator is visible.
     * Checks OCR fingerprint first, then legacy fuzzy fingerprints array.
     * @param {object} item - Item to look up
     * @param {string} shelfType - Shelf type
     * @param {string} lwf - Lightweight fingerprint
     * @returns {Promise<object|null>} Matching collectable or null
     */
    async fuzzyFingerprintLookup(item, shelfType, lwf) {
        const itemTitle = item.title || item.name;

        // Check fuzzy OCR fingerprint
        const ocrFingerprint = makeVisionOcrFingerprint(
            itemTitle,
            item.author || item.primaryCreator || item.creator,
            item.kind || item.type || shelfType,
        );
        if (ocrFingerprint) {
            logger.info('[VisionPipeline.matchCollectable] Checking fuzzy OCR fingerprint:', ocrFingerprint);
            const match = await collectablesQueries.findByFuzzyFingerprint(ocrFingerprint);
            if (match) {
                logger.info('[VisionPipeline.matchCollectable] ✓ Found via fuzzy OCR fingerprint:', match.id, match.title);
                return match;
            }
        }

        // Check legacy fuzzy fingerprints array
        logger.info('[VisionPipeline.matchCollectable] Checking legacy fuzzy fingerprints array:', lwf);
        const legacyMatch = await collectablesQueries.findByFuzzyFingerprint(lwf);
        if (legacyMatch) {
            logger.info('[VisionPipeline.matchCollectable] ✓ Found via legacy fuzzy fingerprint:', legacyMatch.id, legacyMatch.title);
            return legacyMatch;
        }

        return null;
    }

    /**
     * Match an item against the collectables database using shelf-type-aware strategies.
     *
     * Lookup order:
     * 1. Fingerprint (if present from catalog)
     * 2. Lightweight fingerprint (title + creator hash)
     * 3. Shelf-type-specific secondary lookup:
     *    - Books/Games: Fuzzy fingerprint (creator usually visible on spine)
     *    - Movies/TV: Name search via trigram (director rarely visible on spine)
     *
     * @param {object} item - Item to match
     * @param {string} shelfType - Shelf type for strategy selection
     * @returns {Promise<object|null>} Matching collectable or null
     */
    async matchCollectable(item, shelfType) {
        const itemTitle = item.title || item.name;
        const normalizedType = this.normalizeShelfType(shelfType);
        logger.info('[VisionPipeline.matchCollectable] Checking DB for:', itemTitle, '(shelfType:', normalizedType, ')');

        // 1. Always check fingerprint first (if present from catalog)
        if (item.fingerprint) {
            logger.info('[VisionPipeline.matchCollectable] Checking fingerprint:', item.fingerprint);
            const byFp = await collectablesQueries.findByFingerprint(item.fingerprint);
            if (byFp) {
                logger.info('[VisionPipeline.matchCollectable] ✓ Found via fingerprint:', byFp.id, byFp.title);
                return byFp;
            }
        }

        // 2. Always try lightweight fingerprint
        const lwf = makeLightweightFingerprint(item);
        logger.info('[VisionPipeline.matchCollectable] Checking lightweight fingerprint:', lwf);
        let collectable = await collectablesQueries.findByLightweightFingerprint(lwf);
        if (collectable) {
            logger.info('[VisionPipeline.matchCollectable] ✓ Found via lightweight fingerprint:', collectable.id, collectable.title);
            return collectable;
        }

        // 3. Shelf-type-specific secondary lookup
        collectable = await this.shelfTypeSecondaryLookup(item, shelfType, lwf);
        if (collectable) {
            return collectable;
        }

        logger.info('[VisionPipeline.matchCollectable] ✗ No match found for:', itemTitle);
        return null;
    }

    async saveToShelf(items, userId, shelfId, shelfType, hookContext = {}) {
        logger.info('[VisionPipeline.saveToShelf] Processing', items.length, 'items for shelf', shelfId);
        const added = [];
        const failed = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            logger.info(`[VisionPipeline.saveToShelf] Item ${i + 1}/${items.length}:`, item.title || item.name);
            try {
                // Check if item already has a collectable from Step 2 (database match)
                let collectable = item.collectable || null;

                if (!collectable) {
                    // Only call matchCollectable if we don't already have one
                    collectable = await this.matchCollectable(item, shelfType);
                } else {
                    logger.info('[VisionPipeline.saveToShelf] Using pre-matched collectable:', collectable.id, collectable.title);
                }

                if (!collectable) {
                    logger.info('[VisionPipeline.saveToShelf] No existing collectable found, creating new entry...');
                    const title = normalizeString(item.title || item.name);
                    if (!title) {
                        logger.warn('[VisionPipeline.saveToShelf] Skipping - missing title', { item });
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
                    const marketValue = normalizeString(
                        item.marketValue || item.market_value || item.estimatedMarketValue,
                    );
                    const marketValueSources = normalizeSourceLinks(
                        item.marketValueSources || item.market_value_sources || item.marketSources,
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

                    const collectablePayload = {
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
                        marketValue: marketValue || null,
                        marketValueSources,
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
                        // Metadata quality score (from MetadataScorer via CatalogRouter)
                        metascore: (item._metadataScore != null)
                            ? {
                                score: item._metadataScore,
                                maxScore: item._metadataMaxScore ?? null,
                                missing: item._metadataMissing ?? [],
                                scoredAt: new Date().toISOString(),
                            }
                            : null,
                    };
                    await this.executeHook(HOOK_TYPES.BEFORE_COLLECTABLE_SAVE, {
                        ...hookContext,
                        payload: collectablePayload,
                    });
                    // Wrap upsert + addCollectable in a transaction so a failure in addCollectable
                    // rolls back the collectable insert, preventing orphaned records.
                    const { savedCollectable, savedShelfItem } = await transaction(async (txClient) => {
                        const upserted = await collectablesQueries.upsert(collectablePayload, txClient);
                        const shelfEntry = await shelvesQueries.addCollectable({
                            userId,
                            shelfId,
                            collectableId: upserted.id,
                            // Note: format (user-specific) is intentionally not set during vision scan
                            // Users can set their preferred format later via manual edit
                        }, txClient);
                        return { savedCollectable: upserted, savedShelfItem: shelfEntry };
                    });
                    collectable = savedCollectable;
                    logger.info('[VisionPipeline.saveToShelf] Created new collectable:', collectable.id, title);

                    await this.executeHook(HOOK_TYPES.AFTER_SHELF_UPSERT, {
                        ...hookContext,
                        shelfItem: savedShelfItem,
                        collectable,
                    });
                    await this.linkRegionToCollectable(item, collectable.id, hookContext);
                    await this.linkRegionToCollectionItem(item, savedShelfItem?.id, hookContext);

                    added.push({
                        ...item,
                        itemId: savedShelfItem?.id,
                        collectableId: collectable.id,
                        title: collectable.title || item.title || item.name || null,
                        primaryCreator: collectable.primaryCreator || item.primaryCreator || item.author || null,
                        coverUrl: collectable.coverUrl || item.coverUrl || item.coverImage || item.image || null,
                        type: collectable.kind || item.type || item.kind || shelfType,
                    });
                    logger.info('[VisionPipeline.saveToShelf] ✓ Successfully added:', item.title || item.name);
                    continue;
                } else {
                    logger.info('[VisionPipeline.saveToShelf] Using existing collectable:', collectable.id, collectable.title);
                    logger.info('[VisionPipeline.saveToShelf] Matched extracted item to existing record', {
                        extractedTitle: item.title || item.name || null,
                        sourceTable: 'collectables',
                        sourceId: collectable.id,
                        shelfId,
                    });
                }

                // Add pre-matched collectable to shelf
                logger.info('[VisionPipeline.saveToShelf] Adding to shelf:', shelfId, 'collectable:', collectable.id);
                const shelfItem = await shelvesQueries.addCollectable({
                    userId,
                    shelfId,
                    collectableId: collectable.id,
                    // Note: format (user-specific) is intentionally not set during vision scan
                    // Users can set their preferred format later via manual edit
                });
                await this.executeHook(HOOK_TYPES.AFTER_SHELF_UPSERT, {
                    ...hookContext,
                    shelfItem,
                    collectable,
                });
                await this.linkRegionToCollectable(item, collectable.id, hookContext);
                await this.linkRegionToCollectionItem(item, shelfItem?.id, hookContext);

                added.push({
                    ...item,
                    itemId: shelfItem?.id,
                    collectableId: collectable.id,
                    title: collectable.title || item.title || item.name || null,
                    primaryCreator: collectable.primaryCreator || item.primaryCreator || item.author || null,
                    coverUrl: collectable.coverUrl || item.coverUrl || item.coverImage || item.image || null,
                    type: collectable.kind || item.type || item.kind || shelfType,
                });
                logger.info('[VisionPipeline.saveToShelf] ✓ Successfully added:', item.title || item.name);
            } catch (err) {
                logger.error(`Failed to save item ${item.title}:`, err);
                failed.push({
                    ...item,
                    reviewReason: 'save_error',
                    _saveError: sanitizeSaveError(err),
                });
            }
        }
        if (failed.length > 0) {
            logger.info('[VisionPipeline.saveToShelf] Routing failed saves to review queue', {
                failedCount: failed.length,
                shelfId,
                shelfType,
            });
            try {
                await this.saveToReviewQueue(failed, userId, shelfId, {
                    ...hookContext,
                    reason: 'save_error',
                });
            } catch (reviewErr) {
                logger.error('[VisionPipeline.saveToShelf] Failed to route save errors to review queue', {
                    failedCount: failed.length,
                    error: reviewErr?.message || String(reviewErr),
                });
            }
        }
        return { added, failed };
    }

    async resolveOtherManualMatch(item, userId, shelfId, manualFingerprint) {
        if (manualFingerprint) {
            const byFingerprint = await shelvesQueries.findManualByFingerprint({
                userId,
                shelfId,
                manualFingerprint,
            });
            if (byFingerprint) {
                return { status: 'matched', matchSource: 'fingerprint', manual: byFingerprint };
            }
        }

        const byBarcode = await shelvesQueries.findManualByBarcode({
            userId,
            shelfId,
            barcode: item?.normalizedBarcode || item?.barcode,
        });
        if (byBarcode) {
            return { status: 'matched', matchSource: 'barcode', manual: byBarcode };
        }

        const fuzzyCandidate = await shelvesQueries.fuzzyFindManualForOther({
            userId,
            shelfId,
            canonicalTitle: item?.canonicalTitle || item?.title || item?.name,
            canonicalCreator: item?.canonicalCreator || item?.primaryCreator || item?.author || item?.creator,
            minCombinedSim: OTHER_MANUAL_FUZZY_REVIEW_MIN_THRESHOLD,
        });
        const fuzzyDecision = evaluateOtherManualFuzzyCandidate(fuzzyCandidate);
        if (fuzzyDecision.decision === 'fuzzy_auto') {
            return {
                status: 'matched',
                matchSource: 'fuzzy_auto',
                manual: fuzzyCandidate,
                similarity: fuzzyDecision,
            };
        }
        if (fuzzyDecision.decision === 'fuzzy_review') {
            return {
                status: 'review',
                matchSource: 'fuzzy_review',
                manual: fuzzyCandidate,
                similarity: fuzzyDecision,
            };
        }
        return { status: 'none', matchSource: null, manual: null, similarity: fuzzyDecision };
    }

    buildPossibleDuplicateReviewItem(item, manualCandidate, similarity, matchSource) {
        return {
            ...item,
            duplicateReason: 'possible_duplicate',
            duplicateMatchSource: matchSource || 'fuzzy_review',
            duplicateCandidate: manualCandidate
                ? {
                    manualId: manualCandidate.id,
                    name: manualCandidate.name || null,
                    author: manualCandidate.author || null,
                    titleSim: similarity?.titleSim ?? null,
                    creatorSim: similarity?.creatorSim ?? null,
                    combinedSim: similarity?.combinedSim ?? null,
                }
                : null,
        };
    }

    async saveManualToShelf(items, userId, shelfId, shelfType, options = {}) {
        logger.info('[VisionPipeline.saveManualToShelf] Processing', items.length, 'items for shelf', shelfId);
        const added = [];
        const matched = [];
        const skipped = [];
        const review = [];
        const requireCreator = options.requireCreator ?? true;
        const hookContext = options.hookContext || {};
        const isOther = isOtherShelfType(shelfType);

        for (let i = 0; i < items.length; i++) {
            const rawItem = items[i];
            const item = isOther
                ? {
                    ...normalizeOtherManualItem(rawItem, shelfType),
                    extractionIndex: normalizeExtractionIndex(rawItem?.extractionIndex),
                    box2d: normalizeBox2d(rawItem?.box2d ?? rawItem?.box_2d),
                }
                : rawItem;
            const title = normalizeString(item.title || item.name);
            const primaryCreator = normalizeString(
                item.primaryCreator || item.author || item.creator || item.brand || item.publisher || item.manufacturer,
            );
            if (!title || (requireCreator && !primaryCreator)) {
                logger.warn('[VisionPipeline.saveManualToShelf] Missing required fields, routing to review', { item });
                skipped.push(item);
                continue;
            }

            const fingerprintNamespace = isOther ? 'manual-other' : 'manual';
            const manualFingerprint = item.manualFingerprint || makeManualFingerprint({
                title,
                primaryCreator,
                kind: shelfType,
            }, fingerprintNamespace);

            let matchedManual = null;
            let matchSource = null;
            let similarity = null;

            if (isOther) {
                const resolution = await this.resolveOtherManualMatch(item, userId, shelfId, manualFingerprint);
                if (resolution.status === 'review') {
                    logger.info('[VisionPipeline.saveManualToShelf] Routing possible duplicate for manual review', {
                        extractedTitle: title,
                        extractedCreator: primaryCreator,
                        sourceTable: 'user_manuals',
                        sourceId: resolution.manual?.id || null,
                        matchSource: resolution.matchSource,
                        combinedSim: resolution.similarity?.combinedSim ?? null,
                        titleSim: resolution.similarity?.titleSim ?? null,
                        creatorSim: resolution.similarity?.creatorSim ?? null,
                        shelfId,
                    });
                    review.push(this.buildPossibleDuplicateReviewItem(
                        item,
                        resolution.manual,
                        resolution.similarity,
                        resolution.matchSource,
                    ));
                    continue;
                }
                matchedManual = resolution.manual;
                matchSource = resolution.matchSource;
                similarity = resolution.similarity;
            } else if (manualFingerprint) {
                matchedManual = await shelvesQueries.findManualByFingerprint({
                    userId,
                    shelfId,
                    manualFingerprint,
                });
                matchSource = matchedManual ? 'fingerprint' : null;
            }

            if (matchedManual) {
                const existingCollection = await shelvesQueries.findManualCollection({
                    userId,
                    shelfId,
                    manualId: matchedManual.id,
                });
                if (existingCollection) {
                    logger.info('[VisionPipeline.saveManualToShelf] Matched extracted item to existing manual already on shelf', {
                        extractedTitle: title,
                        sourceTable: 'user_manuals',
                        sourceId: matchedManual.id,
                        collectionTable: 'user_collections',
                        collectionId: existingCollection.id,
                        matchSource,
                        combinedSim: similarity?.combinedSim ?? null,
                        titleSim: similarity?.titleSim ?? null,
                        creatorSim: similarity?.creatorSim ?? null,
                        shelfId,
                    });
                    await this.linkRegionToManual(item, matchedManual.id, hookContext);
                    await this.linkRegionToCollectionItem(item, existingCollection.id, hookContext);
                    matched.push({
                        ...item,
                        itemId: existingCollection.id,
                        manualId: matchedManual.id,
                        manual: matchedManual,
                        title: matchedManual.name || title,
                        primaryCreator: matchedManual.author || primaryCreator,
                        type: shelfType,
                    });
                    continue;
                }

                const collection = await shelvesQueries.addManualCollection({
                    userId,
                    shelfId,
                    manualId: matchedManual.id,
                });
                logger.info('[VisionPipeline.saveManualToShelf] Matched extracted item to existing manual and linked to shelf', {
                    extractedTitle: title,
                    sourceTable: 'user_manuals',
                    sourceId: matchedManual.id,
                    collectionTable: 'user_collections',
                    collectionId: collection.id,
                    matchSource,
                    combinedSim: similarity?.combinedSim ?? null,
                    titleSim: similarity?.titleSim ?? null,
                    creatorSim: similarity?.creatorSim ?? null,
                    shelfId,
                });
                await this.executeHook(HOOK_TYPES.AFTER_SHELF_UPSERT, {
                    ...hookContext,
                    shelfItem: collection,
                    manual: matchedManual,
                });
                await this.linkRegionToManual(item, matchedManual.id, hookContext);
                await this.linkRegionToCollectionItem(item, collection.id, hookContext);
                added.push({
                    ...item,
                    itemId: collection.id,
                    manualId: matchedManual.id,
                    manual: matchedManual,
                    title: matchedManual.name || title,
                    primaryCreator: matchedManual.author || primaryCreator,
                    type: shelfType,
                });
                continue;
            }

            logger.info('[VisionPipeline.saveManualToShelf] No existing manual match found, creating new manual entry', {
                extractedTitle: title,
                extractedCreator: primaryCreator,
                matchSource: 'new_insert',
                shelfId,
            });

            const payload = isOther
                ? buildOtherManualPayload(item, shelfType, manualFingerprint)
                : buildGenericManualPayload(item, shelfType, manualFingerprint);
            await this.executeHook(HOOK_TYPES.BEFORE_MANUAL_SAVE, {
                ...hookContext,
                payload,
            });
            const result = await shelvesQueries.addManual({
                userId,
                shelfId,
                ...payload,
                tags: payload.tags || item.tags,
            });
            await this.executeHook(HOOK_TYPES.AFTER_SHELF_UPSERT, {
                ...hookContext,
                shelfItem: result.collection,
                manual: result.manual,
            });
            await this.linkRegionToManual(item, result.manual.id, hookContext);
            await this.linkRegionToCollectionItem(item, result.collection.id, hookContext);

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

        return { added, matched, skipped, review };
    }

    async saveToReviewQueue(items, userId, shelfId, context = {}) {
        if (!Array.isArray(items) || items.length === 0) {
            logger.info('[VisionPipeline.saveToReviewQueue] No items to add to review queue');
            return;
        }
        if (!this.reviewQueueAvailable) {
            logger.info('[VisionPipeline.saveToReviewQueue] Review queue not available, skipping');
            return;
        }

        logger.info('[VisionPipeline.saveToReviewQueue] Adding', items.length, 'items to review queue');
        let inserted = [];
        try {
            // Wrap all inserts in a single transaction so a partial failure rolls back the whole batch.
            inserted = await transaction(async (txClient) => {
                const saved = [];
                for (const item of items) {
                    logger.info('[VisionPipeline.saveToReviewQueue] Adding:', item.title || item.name, '(confidence:', item.confidence, ')');
                    await needsReviewQueries.create({
                        userId,
                        shelfId,
                        rawData: item,
                        confidence: item.confidence,
                    }, txClient);
                    saved.push(item);
                }
                return saved;
            });
        } catch (err) {
            if (isMissingRelationError(err, 'needs_review')) {
                this.reviewQueueAvailable = false;
                logger.warn('[VisionPipelineService] needs_review table missing; skipping review queue.');
                return;
            }
            throw err;
        }

        if (inserted.length > 0) {
            await this.executeHook(HOOK_TYPES.AFTER_NEEDS_REVIEW_QUEUE, {
                ...context,
                items: inserted,
                count: inserted.length,
            });
        }
    }
}

module.exports = { VisionPipelineService };
