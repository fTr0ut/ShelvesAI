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

// Configurable threshold (default 90%)
const AUTO_ADD_THRESHOLD = parseFloat(process.env.VISION_AUTO_ADD_THRESHOLD || '0.9');

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
     */
    async processImage(imageBase64, shelf, userId) {
        if (!shelf || !shelf.type) throw new Error('Invalid shelf provided');

        // Step 1: Extract items from image
        const rawItems = await this.extractItems(imageBase64, shelf.type);

        // Step 2: Lookup in catalog API
        const catalogResults = await this.lookupCatalog(rawItems, shelf.type);

        // Step 3: Enrich unresolved with Gemini
        // We only enrich items that weren't resolved by the catalog to save costs/latency
        // But for "needs review" items, we might want Gemini to take a pass at them too if catalog failed
        const enriched = await this.enrichUnresolved(catalogResults.unresolved, shelf.type);

        // Step 4: Combine and categorize by confidence
        // resolved items generally have high confidence (e.g. 1.0 from catalog)
        const allItems = [...catalogResults.resolved, ...enriched];
        const { autoAdd, needsReview } = this.categorizeByConfidence(allItems);

        // Step 5: Process auto-add items
        const addedItems = await this.saveToShelf(autoAdd, userId, shelf.id, shelf.type);

        // Step 6: Save needs-review items
        await this.saveToReviewQueue(needsReview, userId, shelf.id);

        return {
            analysis: { shelfConfirmed: true, items: allItems },
            results: { added: addedItems.length, needsReview: needsReview.length },
            addedItems,
            needsReview
        };
    }

    async extractItems(imageBase64, shelfType) {
        // Gemini Vision Detect (Cloud Vision temporarily disabled)
        const detectionResult = await this.geminiService.detectShelfItemsFromImage(imageBase64, shelfType);
        return detectionResult.items || [];
    }

    async lookupCatalog(items, shelfType) {
        const catalogService = this.resolveCatalogServiceForShelf(shelfType);
        if (!catalogService) {
            // If no catalog service (e.g. music/custom), everything is unresolved
            return { resolved: [], unresolved: items };
        }

        if (typeof catalogService.lookupFirstPass === 'function') {
            const resolved = [];
            const unresolved = [];
            try {
                const results = await catalogService.lookupFirstPass(items);
                const entries = Array.isArray(results) ? results : [];

                for (let index = 0; index < items.length; index++) {
                    const entry = entries[index];
                    const input = entry?.input || items[index];
                    if (entry && entry.status === 'resolved' && entry.enrichment) {
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
                    if (input) unresolved.push(input);
                }
                return { resolved, unresolved };
            } catch (err) {
                console.error('[VisionPipelineService.lookupCatalog] lookupFirstPass failed', err);
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

    categorizeByConfidence(items) {
        const autoAdd = [];
        const needsReview = [];

        items.forEach(item => {
            if (item.confidence >= AUTO_ADD_THRESHOLD) {
                autoAdd.push(item);
            } else {
                needsReview.push(item);
            }
        });

        return { autoAdd, needsReview };
    }

    async matchCollectable(item, shelfType) {
        // 1. Lightweight fingerprint
        const lwf = makeLightweightFingerprint(item);
        let collectable = await collectablesQueries.findByLightweightFingerprint(lwf);

        if (collectable) return collectable;

        // 2. Fuzzy Match
        // Assuming fuzzyMatch signature: (title, creatorName, kind)
        if (collectablesQueries.fuzzyMatch) {
            collectable = await collectablesQueries.fuzzyMatch(item.title, item.primaryCreator, shelfType);
        }

        return collectable;
    }

    async saveToShelf(items, userId, shelfId, shelfType) {
        const added = [];
        for (const item of items) {
            try {
                let collectable = await this.matchCollectable(item, shelfType);

                if (!collectable) {
                    const title = normalizeString(item.title || item.name);
                    if (!title) {
                        console.warn('[VisionPipelineService.saveToShelf] missing title', { item });
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
                        fuzzyFingerprints: normalizeArray(item.fuzzyFingerprints),
                    });
                }

                // Add to shelf
                await shelvesQueries.addCollectable({
                    userId,
                    shelfId,
                    collectableId: collectable.id
                });

                added.push({ ...item, collectableId: collectable.id });
            } catch (err) {
                console.error(`Failed to save item ${item.title}:`, err);
                // Fail safe: maybe add to review queue instead?
                // For now, just skip
            }
        }
        return added;
    }

    async saveToReviewQueue(items, userId, shelfId) {
        if (!Array.isArray(items) || items.length === 0) return;
        if (!this.reviewQueueAvailable) return;

        for (const item of items) {
            try {
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
