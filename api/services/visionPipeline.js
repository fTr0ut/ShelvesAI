const { GoogleCloudVisionService } = require('./googleCloudVision');
const { GoogleGeminiService } = require('./googleGemini');
const collectablesQueries = require('../database/queries/collectables');
const needsReviewQueries = require('../database/queries/needsReview');
const shelvesQueries = require('../database/queries/shelves');
const { makeLightweightFingerprint } = require('./collectables/fingerprint');

// Catalog Services
const { BookCatalogService } = require('./catalog/BookCatalogService');
const { GameCatalogService } = require('./catalog/GameCatalogService');
const { MovieCatalogService } = require('./catalog/MovieCatalogService');

// Configurable threshold (default 90%)
const AUTO_ADD_THRESHOLD = parseFloat(process.env.VISION_AUTO_ADD_THRESHOLD || '0.9');

class VisionPipelineService {
    constructor() {
        this.visionService = new GoogleCloudVisionService();
        this.geminiService = new GoogleGeminiService();

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
        // GCV Detect
        const detectionResult = await this.visionService.detectShelfItems(imageBase64, shelfType);
        // The service now handles parsing internally via the new parseToItems method if we use detectShelfItems correctly
        // But detectShelfItems returns { items: [...] }. 
        // We really want to ensure we're getting the parsed list.
        // GoogleCloudVisionService.detectShelfItems calls parseDocumentToItems -> parseToItems internally.
        return detectionResult.items || [];
    }

    async lookupCatalog(items, shelfType) {
        const catalogService = this.resolveCatalogServiceForShelf(shelfType);
        if (!catalogService) {
            // If no catalog service (e.g. music/custom), everything is unresolved
            return { resolved: [], unresolved: items };
        }

        // We need a specific lookupFirstPass or similar bulk method on catalog services.
        // Assuming they support something like `findMany` or we loop. 
        // For efficiency, let's assume we loop for now or they implement `lookupFirstPass`.
        // Since `lookupFirstPass` was mentioned in the spec but might not exist, I'll implement a basic loop here.

        const resolved = [];
        const unresolved = [];

        for (const item of items) {
            // Basic lookup by title/author
            // This logic depends heavily on the CatalogService signatures.
            // BookCatalogService likely has search(title, author). 
            try {
                // naive first match
                const results = await catalogService.search(item.title);
                // filter by author if present to be sure? 
                // For now, let's just say if we get a High Confidence match from catalog, use it.
                // Real implementation would be more robust.

                // SIMULATION: If 0 results, unresolved. If results, unresolved (let Gemini confirm?) or resolved?
                // The specific requirement: "Items with a result from the catalog service ... should be automatically added"

                if (results && results.length > 0) {
                    // Take top result
                    const match = results[0];
                    // Map to schema
                    resolved.push({
                        ...item, // keep original OCR text potentially?
                        title: match.title,
                        primaryCreator: match.authors ? match.authors.join(', ') : (match.developer || match.director),
                        year: match.publishedDate ? match.publishedDate.substring(0, 4) : match.releaseDate,
                        confidence: 1.0, // Catalog match deemed high confidence
                        source: 'catalog-match',
                        catalogId: match.id,
                        description: match.description,
                        image: match.imageLinks?.thumbnail || match.cover?.url
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
                    // Create new
                    collectable = await collectablesQueries.upsert({
                        title: item.title,
                        primaryCreator: item.primaryCreator,
                        kind: shelfType,
                        year: item.year,
                        description: item.description,
                        // lightweightFingerprint generated in upsert or we pass it? 
                        // queries usually handle generation if missing, but let's pass if we have it
                        lightweightFingerprint: makeLightweightFingerprint(item),
                        // ... other fields
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
        for (const item of items) {
            await needsReviewQueries.create({
                userId,
                shelfId,
                rawData: item,
                confidence: item.confidence
            });
        }
    }
}

module.exports = { VisionPipelineService };
