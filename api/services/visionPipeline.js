const { GoogleGeminiService } = require('./googleGemini');
// const { GoogleCloudVisionService } = require('./googleCloudVision'); // Temporarily disabled; keep for easy re-enable.
const collectablesQueries = require('../database/queries/collectables');
const needsReviewQueries = require('../database/queries/needsReview');
const shelvesQueries = require('../database/queries/shelves');
const { makeCollectableFingerprint, makeLightweightFingerprint } = require('./collectables/fingerprint');

// Catalog Services
const { BookCatalogService } = require('./catalog/BookCatalogService');
const { GameCatalogService } = require('./catalog/GameCatalogService');
const { MovieCatalogService } = require('./catalog/MovieCatalogService');

// Tiered confidence thresholds (configurable via env)
// High confidence (≥ max): catalog workflow
// Medium confidence (≥ min, < max): special enrichment only (skip catalog APIs)
// Low confidence (< min): needs_review directly
const VISION_CONFIDENCE_MAX = parseFloat(process.env.VISION_CONFIDENCE_MAX || '0.92');
const VISION_CONFIDENCE_MIN = parseFloat(process.env.VISION_CONFIDENCE_MIN || '0.85');

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
     */
    async processImage(imageBase64, shelf, userId) {
        if (!shelf || !shelf.type) throw new Error('Invalid shelf provided');
        console.log('[VisionPipeline] === Starting processImage ===', { shelfId: shelf.id, shelfType: shelf.type, userId });

        // Step 1: Extract items from image
        console.log('[VisionPipeline] Step 1: Extracting items from image via Gemini Vision...');
        const rawItems = await this.extractItems(imageBase64, shelf.type);
        console.log('[VisionPipeline] Step 1 Complete: Extracted', rawItems.length, 'items:', rawItems.map(i => i.title || i.name));

        // Step 1b: Categorize into three tiers
        console.log('[VisionPipeline] Step 1b: Categorizing by confidence tiers...');
        const { highConfidence, mediumConfidence, lowConfidence } = this.categorizeByConfidence(rawItems);

        // Low confidence items go directly to needs_review
        if (lowConfidence.length > 0) {
            console.log('[VisionPipeline] Sending', lowConfidence.length, 'low-confidence items (<' + VISION_CONFIDENCE_MIN + ') to review queue...');
            await this.saveToReviewQueue(lowConfidence, userId, shelf.id);
        }

        // ===== HIGH CONFIDENCE WORKFLOW (≥ max threshold) =====
        // Step 2: Fingerprint lookup for high confidence items
        console.log('[VisionPipeline] Step 2: Fingerprint lookup for', highConfidence.length, 'high-confidence items...');
        const matched = [];
        const unmatchedHigh = [];
        for (const item of highConfidence) {
            const collectable = await this.matchCollectable(item, shelf.type);
            if (collectable) {
                matched.push({ ...item, collectable, source: 'database-match' });
            } else {
                unmatchedHigh.push(item);
            }
        }
        console.log('[VisionPipeline] Step 2 Complete: Matched in DB:', matched.length, ', Unmatched high-conf:', unmatchedHigh.length);

        // Step 3: Catalog lookup for unmatched HIGH confidence items only
        let catalogResults = { resolved: [], unresolved: [] };
        if (unmatchedHigh.length > 0) {
            console.log('[VisionPipeline] Step 3: Catalog lookup for', unmatchedHigh.length, 'unmatched high-confidence items...');
            catalogResults = await this.lookupCatalog(unmatchedHigh, shelf.type);
            console.log('[VisionPipeline] Step 3 Complete: Catalog resolved:', catalogResults.resolved.length, ', Still unresolved:', catalogResults.unresolved.length);
        } else {
            console.log('[VisionPipeline] Step 3: Skipped - all high-confidence items matched in database');
        }

        // Step 4a: Standard enrichment for high-confidence items that failed both fingerprint AND catalog
        let enrichedHighConf = [];
        if (catalogResults.unresolved.length > 0) {
            console.log('[VisionPipeline] Step 4a: Standard enrichment for', catalogResults.unresolved.length, 'unresolved high-confidence items...');

            const rawOcrFingerprints = new Map();
            for (const item of catalogResults.unresolved) {
                const rawFp = makeLightweightFingerprint(item);
                rawOcrFingerprints.set(item.title || item.name, rawFp);
            }

            const enrichedResults = await this.enrichUnresolved(catalogResults.unresolved, shelf.type);
            enrichedHighConf = enrichedResults.map(enrichedItem => {
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
                    const rawFp = makeLightweightFingerprint(item);
                    rawOcrFingerprints.set(item.title || item.name, rawFp);
                }

                // Use special uncertain prompt for medium confidence
                const enrichedResults = await this.enrichUncertain(mediumUnmatched, shelf.type);
                enrichedMediumConf = enrichedResults.map(enrichedItem => {
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
        const { highConfidence: enrichedToSave, mediumConfidence: enrichedMedium, lowConfidence: enrichedToReview } = this.categorizeByConfidence(allEnriched);

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
        const addedItems = await this.saveToShelf(allResolvedItems, userId, shelf.id, shelf.type);
        console.log('[VisionPipeline] Step 5 Complete: Added', addedItems.length, 'items to shelf');

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
            needsReview: [...lowConfidence, ...itemsToReview]
        };
    }

    async extractItems(imageBase64, shelfType) {
        // Gemini Vision Detect (Cloud Vision temporarily disabled)
        const detectionResult = await this.geminiService.detectShelfItemsFromImage(imageBase64, shelfType);
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
     * - highConfidence (≥ VISION_CONFIDENCE_MAX): catalog workflow
     * - mediumConfidence (≥ VISION_CONFIDENCE_MIN, < MAX): special enrichment
     * - lowConfidence (< VISION_CONFIDENCE_MIN): needs_review directly
     */
    categorizeByConfidence(items) {
        const highConfidence = [];
        const mediumConfidence = [];
        const lowConfidence = [];

        items.forEach(item => {
            const conf = item.confidence ?? 0;
            if (conf >= VISION_CONFIDENCE_MAX) {
                highConfidence.push(item);
            } else if (conf >= VISION_CONFIDENCE_MIN) {
                mediumConfidence.push(item);
            } else {
                lowConfidence.push(item);
            }
        });

        console.log('[VisionPipeline.categorizeByConfidence] Tiers:', {
            high: highConfidence.length,
            medium: mediumConfidence.length,
            low: lowConfidence.length,
            thresholds: { max: VISION_CONFIDENCE_MAX, min: VISION_CONFIDENCE_MIN }
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
            console.log('[VisionPipeline.matchCollectable] Checking fuzzy fingerprints array:', lwf);
            collectable = await collectablesQueries.findByFuzzyFingerprint(lwf);
            if (collectable) {
                console.log('[VisionPipeline.matchCollectable] ✓ Found via fuzzy fingerprint:', collectable.id, collectable.title);
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
                    const tags = normalizeStringArray(item.tags, item.genre);
                    const creators = normalizeStringArray(item.creators, primaryCreator);
                    const identifiers = normalizeIdentifiers(item.identifiers);
                    const images = normalizeArray(item.images);
                    const sources = normalizeArray(item.sources);
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
                        format: item.format,
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
                    });
                    console.log('[VisionPipeline.saveToShelf] Created new collectable:', collectable.id, title);
                } else {
                    console.log('[VisionPipeline.saveToShelf] Using existing collectable:', collectable.id, collectable.title);
                }

                // Add to shelf
                console.log('[VisionPipeline.saveToShelf] Adding to shelf:', shelfId, 'collectable:', collectable.id);
                await shelvesQueries.addCollectable({
                    userId,
                    shelfId,
                    collectableId: collectable.id
                });

                added.push({ ...item, collectableId: collectable.id });
                console.log('[VisionPipeline.saveToShelf] ✓ Successfully added:', item.title || item.name);
            } catch (err) {
                console.error(`Failed to save item ${item.title}:`, err);
                // Fail safe: maybe add to review queue instead?
                // For now, just skip
            }
        }
        return added;
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
