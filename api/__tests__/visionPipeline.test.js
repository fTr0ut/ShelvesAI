const { VisionPipelineService } = require('../services/visionPipeline');
const { GoogleGeminiService, getVisionSettingsForType } = require('../services/googleGemini');
const collectablesQueries = require('../database/queries/collectables');
const needsReviewQueries = require('../database/queries/needsReview');
const shelvesQueries = require('../database/queries/shelves');
const visionItemRegionsQueries = require('../database/queries/visionItemRegions');
const pg = require('../database/pg');
const processingStatus = require('../services/processingStatus');
const { getMetadataScorer } = require('../services/catalog/MetadataScorer');
const { CatalogProvidersUnavailableError } = require('../services/catalog/errors');

jest.mock('../services/googleGemini');
jest.mock('../database/queries/collectables');
jest.mock('../database/queries/needsReview');
jest.mock('../database/queries/shelves');
jest.mock('../database/queries/visionItemRegions', () => ({
    upsertRegionsForScan: jest.fn().mockResolvedValue([]),
    linkCollectable: jest.fn().mockResolvedValue(null),
    linkManual: jest.fn().mockResolvedValue(null),
    linkCollectionItem: jest.fn().mockResolvedValue(null),
    clearCollectionItemLink: jest.fn().mockResolvedValue(null),
    hasCollectionItemLinkForReference: jest.fn().mockResolvedValue(false),
}));
jest.mock('../services/collectables/fingerprint', () => ({
    makeLightweightFingerprint: jest.fn(item => 'fingerprint-' + item.title),
    makeVisionOcrFingerprint: jest.fn(() => 'ocr-fingerprint'),
    makeCollectableFingerprint: jest.fn(() => 'collectable-fingerprint'),
    makeManualFingerprint: jest.fn((input) => {
        const creator = input?.primaryCreator || input?.author || input?.creator;
        return input?.title && creator ? 'manual-fingerprint' : null;
    }),
}));
jest.mock('../services/catalog/BookCatalogService');
jest.mock('../services/catalog/MetadataScorer', () => ({
    getMetadataScorer: jest.fn(),
}));

describe('VisionPipelineService', () => {
    let service;
    let mockGemini;

    beforeEach(() => {
        jest.clearAllMocks();
        getVisionSettingsForType.mockReturnValue({});
        getMetadataScorer.mockReturnValue({
            scoreAsync: jest.fn().mockResolvedValue({
                score: 65,
                maxScore: 100,
                missing: ['description'],
                scoredAt: '2026-03-31T12:00:00.000Z',
            }),
        });
        service = new VisionPipelineService();
        mockGemini = GoogleGeminiService.mock.instances[0];
        mockGemini.detectShelfItemsFromImage = jest.fn();
        mockGemini.sendScoutPrompt = jest.fn().mockResolvedValue(JSON.stringify({
            full_image_estimated_item_count: 3,
            full_image_has_more_than_ten: false,
            regions: [{ region_box_2d: [0, 0, 1000, 1000], confidence: 0.9, estimated_item_count: 3, has_more_than_ten: false }],
        }));
    });

    it('should process high confidence items and add them to shelf', async () => {
        // Setup mocks
        mockGemini.detectShelfItemsFromImage.mockResolvedValue({ items: [{ title: 'Book 1', confidence: 0.95 }] });

        // Mock catalog lookup (unresolved)
        service.resolveCatalogServiceForShelf = jest.fn().mockReturnValue({
            search: jest.fn().mockResolvedValue([])
        });

        // Mock Enrichment (passthrough)
        mockGemini.enrichWithSchema.mockResolvedValue([{ title: 'Book 1', confidence: 0.95, kind: 'book' }]);

        // Mock DB
        collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
        collectablesQueries.upsert.mockResolvedValue({ id: 123 });
        shelvesQueries.addCollectable.mockResolvedValue({ id: 999 });

        const result = await service.processImage('base64', { id: 1, type: 'book' }, 100);

        expect(result.results.added).toBe(1);
        expect(result.results.needsReview).toBe(0);
        expect(shelvesQueries.addCollectable).toHaveBeenCalled();
        expect(needsReviewQueries.create).not.toHaveBeenCalled();
    });

    it('should send low confidence items to review queue', async () => {
        mockGemini.detectShelfItemsFromImage.mockResolvedValue({ items: [{ title: 'Blurry Book', confidence: 0.5 }] });

        service.resolveCatalogServiceForShelf = jest.fn().mockReturnValue({
            search: jest.fn().mockResolvedValue([])
        });

        mockGemini.enrichWithSchema.mockResolvedValue([{ title: 'Blurry Book', confidence: 0.5, kind: 'book' }]);

        const result = await service.processImage('base64', { id: 1, type: 'book' }, 100);

        expect(result.results.added).toBe(0);
        expect(result.results.needsReview).toBe(1);
        expect(shelvesQueries.addCollectable).not.toHaveBeenCalled();
        expect(needsReviewQueries.create).toHaveBeenCalled();
    });

    it('should integrate catalog results', async () => {
        mockGemini.detectShelfItemsFromImage.mockResolvedValue({ items: [{ title: 'Known Book', confidence: 0.95 }] });

        const mockCatalog = {
            search: jest.fn().mockResolvedValue([{ title: 'Known Book', authors: ['Author'], id: 'cat-1' }])
        };
        service.resolveCatalogServiceForShelf = jest.fn().mockReturnValue(mockCatalog);

        // Catalog result should bypass enrichment
        mockGemini.enrichWithSchema.mockResolvedValue([]);

        collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
        collectablesQueries.upsert.mockResolvedValue({ id: 124 });

        const result = await service.processImage('base64', { id: 1, type: 'book' }, 100);

        expect(result.results.added).toBe(1);
        // Should have come from catalog (mocked logic in pipeline sets confidence 1.0)
        expect(result.addedItems[0].source).toBe('catalog-match');
    });

    it('persists the highest metadata score when saving a new collectable', async () => {
        collectablesQueries.findByFingerprint.mockResolvedValue(null);
        collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
        collectablesQueries.findByFuzzyFingerprint.mockResolvedValue(null);
        collectablesQueries.upsert.mockResolvedValue({ id: 124, title: 'Known Book', kind: 'book' });
        shelvesQueries.addCollectable.mockResolvedValue({ id: 999 });

        await service.saveToShelf(
            [{
                title: 'Known Book',
                kind: 'book',
                _metadataScore: 55,
                _metadataMaxScore: 100,
                _metadataMissing: ['publisher'],
                metascore: {
                    score: 60,
                    maxScore: 100,
                    missing: ['year'],
                    scoredAt: '2026-03-31T01:00:00.000Z',
                },
            }],
            1,
            10,
            'book',
        );

        expect(collectablesQueries.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                metascore: expect.objectContaining({
                    score: 65,
                    maxScore: 100,
                }),
            }),
            expect.any(Object),
        );
    });

    it('marks platformMissing on games shelf default mismatch while still saving item', async () => {
        shelvesQueries.addCollectable.mockResolvedValue({ id: 88 });
        shelvesQueries.replaceOwnedPlatformsForCollectionItem.mockResolvedValue([]);
        shelvesQueries.updateCollectionItemGameDefaults.mockResolvedValue({ id: 88, format: null, platformMissing: true });

        const result = await service.saveToShelf(
            [
                {
                    title: 'Halo Infinite',
                    collectable: {
                        id: 501,
                        title: 'Halo Infinite',
                        kind: 'games',
                        systemName: 'Xbox Series X|S',
                        platformData: [{ name: 'Xbox Series X|S' }],
                    },
                },
            ],
            1,
            10,
            'games',
            { shelfGameDefaults: { platformType: 'playstation', format: 'physical' } },
        );

        expect(shelvesQueries.addCollectable).toHaveBeenCalledWith(expect.objectContaining({
            collectableId: 501,
            format: null,
            platformMissing: true,
        }));
        expect(shelvesQueries.updateCollectionItemGameDefaults).toHaveBeenCalledWith({
            collectionItemId: 88,
            userId: 1,
            shelfId: 10,
            format: null,
            platformMissing: true,
        }, null);
        expect(result.added).toHaveLength(1);
    });

    it('preserves extractionIndex and box2d when catalog resolves an item', async () => {
        const mockCatalog = {
            lookupFirstPass: jest.fn().mockResolvedValue([
                {
                    status: 'resolved',
                    input: {
                        title: 'Known Book',
                        extractionIndex: 4,
                        box2d: [120, 90, 870, 210],
                    },
                    enrichment: { title: 'Known Book' },
                },
            ]),
        };
        service.resolveCatalogServiceForShelf = jest.fn().mockReturnValue(mockCatalog);

        const result = await service.lookupCatalog(
            [{ title: 'Known Book', extractionIndex: 4, box2d: [120, 90, 870, 210] }],
            'book',
        );

        expect(result.resolved).toHaveLength(1);
        expect(result.resolved[0].extractionIndex).toBe(4);
        expect(result.resolved[0].box2d).toEqual([120, 90, 870, 210]);
    });

    it('throws when catalog providers are globally unavailable', async () => {
        const unavailableError = new CatalogProvidersUnavailableError('providers down');
        const mockCatalog = {
            lookupFirstPass: jest.fn().mockRejectedValue(unavailableError),
        };
        service.resolveCatalogServiceForShelf = jest.fn().mockReturnValue(mockCatalog);

        await expect(
            service.lookupCatalog([{ title: 'Known Book' }], 'book', {
                catalogContext: { jobId: 'job-down' },
            })
        ).rejects.toMatchObject({ code: 'CATALOG_PROVIDERS_UNAVAILABLE' });
    });

    it('does not throw provider-unavailable when catalog returns unresolved items', async () => {
        const mockCatalog = {
            lookupFirstPass: jest.fn().mockResolvedValue([
                {
                    status: 'unresolved',
                    input: { title: 'Unknown Book' },
                },
            ]),
        };
        service.resolveCatalogServiceForShelf = jest.fn().mockReturnValue(mockCatalog);

        const result = await service.lookupCatalog([{ title: 'Unknown Book' }], 'book', {
            catalogContext: { jobId: 'job-ok' },
        });

        expect(result).toEqual({
            resolved: [],
            unresolved: [{ title: 'Unknown Book' }],
        });
    });

    it('should propagate vision extraction failures instead of silently succeeding with zero items', async () => {
        mockGemini.detectShelfItemsFromImage.mockRejectedValue(
            Object.assign(new Error('Vision extraction provider request failed. Please retry.'), {
                code: 'VISION_PROVIDER_UNAVAILABLE',
            }),
        );

        await expect(
            service.processImage('base64', { id: 1, type: 'book' }, 100)
        ).rejects.toThrow('Vision extraction provider request failed');
    });

    describe('persistVisionRegions', () => {
        it('pads normalized box_2d values before persistence when scan dimensions are known', async () => {
            await service.persistVisionRegions(
                [
                    {
                        extractionIndex: 1,
                        title: 'Padded Box',
                        box2d: [100, 200, 700, 900],
                        confidence: 0.9,
                    },
                ],
                1,
                10,
                21,
                { width: 1200, height: 800 },
            );

            expect(visionItemRegionsQueries.upsertRegionsForScan).toHaveBeenCalledWith({
                userId: 1,
                shelfId: 10,
                scanPhotoId: 21,
                replaceExisting: true,
                regions: [
                    expect.objectContaining({
                        extractionIndex: 1,
                        box2d: [70, 160, 730, 940],
                    }),
                ],
            });
        });

        it('clamps padded boxes to image boundaries', async () => {
            await service.persistVisionRegions(
                [
                    {
                        extractionIndex: 3,
                        title: 'Edge Box',
                        box2d: [10, 5, 990, 995],
                    },
                ],
                1,
                10,
                23,
                { width: 1000, height: 1000 },
            );

            expect(visionItemRegionsQueries.upsertRegionsForScan).toHaveBeenCalledWith({
                userId: 1,
                shelfId: 10,
                scanPhotoId: 23,
                replaceExisting: true,
                regions: [
                    expect.objectContaining({
                        extractionIndex: 3,
                        box2d: [0, 0, 1000, 1000],
                    }),
                ],
            });
        });

        it('keeps normalized boxes unchanged when scan dimensions are unavailable', async () => {
            await service.persistVisionRegions(
                [
                    {
                        extractionIndex: 4,
                        title: 'No Dims',
                        box2d: [100, 200, 700, 900],
                    },
                ],
                1,
                10,
                24,
                null,
            );

            expect(visionItemRegionsQueries.upsertRegionsForScan).toHaveBeenCalledWith({
                userId: 1,
                shelfId: 10,
                scanPhotoId: 24,
                replaceExisting: true,
                regions: [
                    expect.objectContaining({
                        extractionIndex: 4,
                        box2d: [100, 200, 700, 900],
                    }),
                ],
            });
        });

        it('does not persist invalid raw box_2d values when normalized box2d is null', async () => {
            await service.persistVisionRegions(
                [
                    {
                        extractionIndex: 0,
                        title: 'Invalid Box',
                        box2d: null,
                        box_2d: [700, 200, 700, 300],
                    },
                ],
                1,
                10,
                15,
                { width: 1200, height: 800 },
            );

            expect(visionItemRegionsQueries.upsertRegionsForScan).toHaveBeenCalledWith({
                userId: 1,
                shelfId: 10,
                scanPhotoId: 15,
                regions: [],
                replaceExisting: true,
            });
        });

        it('repairs absolute-style box_2d values using scan dimensions', async () => {
            await service.persistVisionRegions(
                [
                    {
                        extractionIndex: 2,
                        title: 'Absolute Box',
                        box2d: null,
                        box_2d: [200, 400, 1200, 800],
                        confidence: 0.9,
                    },
                ],
                1,
                10,
                22,
                { width: 2000, height: 2000 },
            );

            expect(visionItemRegionsQueries.upsertRegionsForScan).toHaveBeenCalledWith({
                userId: 1,
                shelfId: 10,
                scanPhotoId: 22,
                replaceExisting: true,
                regions: [
                    expect.objectContaining({
                        extractionIndex: 2,
                        box2d: [88, 176, 612, 424],
                    }),
                ],
            });
        });

        it('clamps slight raw provider overflow as normalized noise during region persistence', async () => {
            await service.persistVisionRegions(
                [
                    {
                        extractionIndex: 5,
                        title: 'Blu-ray Overflow',
                        box2d: null,
                        box_2d: [629, 993, 856, 1028],
                    },
                ],
                1,
                10,
                25,
                { width: 4284, height: 5712 },
            );

            expect(visionItemRegionsQueries.upsertRegionsForScan).toHaveBeenCalledWith({
                userId: 1,
                shelfId: 10,
                scanPhotoId: 25,
                replaceExisting: true,
                regions: [
                    expect.objectContaining({
                        extractionIndex: 5,
                        box2d: [625, 982, 860, 1000],
                    }),
                ],
            });
        });

        it('prefers canonical normalized box2d over raw out-of-range box_2d during persistence', async () => {
            await service.persistVisionRegions(
                [
                    {
                        extractionIndex: 6,
                        title: 'Canonical Wins',
                        box2d: [629, 993, 856, 1000],
                        box_2d: [629, 993, 856, 1028],
                    },
                ],
                1,
                10,
                26,
                { width: 4284, height: 5712 },
            );

            expect(visionItemRegionsQueries.upsertRegionsForScan).toHaveBeenCalledWith({
                userId: 1,
                shelfId: 10,
                scanPhotoId: 26,
                replaceExisting: true,
                regions: [
                    expect.objectContaining({
                        extractionIndex: 6,
                        box2d: [625, 982, 860, 1000],
                    }),
                ],
            });
        });
    });

    describe('medium enrichment dedupe guards', () => {
        it('keeps medium enrichment scoped to unresolved medium items when chat continuation returns extra entries', async () => {
            let nextItemId = 1;
            let nextCollectableId = 100;
            const saveToShelfSpy = jest.spyOn(service, 'saveToShelf').mockImplementation(async (items) => ({
                added: items.map((item, index) => ({
                    ...item,
                    itemId: nextItemId++,
                    collectableId: nextCollectableId++,
                })),
                failed: [],
            }));
            const matchSpy = jest.spyOn(service, 'matchCollectable').mockResolvedValue(null);
            const lookupSpy = jest.spyOn(service, 'lookupCatalog')
                .mockImplementationOnce(async (items) => ({
                    // High-confidence branch resolves two items.
                    resolved: items.map((item) => ({ ...item, confidence: 1.0, source: 'catalog-match' })),
                    unresolved: [],
                }))
                .mockImplementationOnce(async (items) => ({
                    // Medium-confidence branch leaves one unresolved item for enrichment.
                    resolved: [],
                    unresolved: items,
                }));

            mockGemini.enrichWithSchemaUncertain = jest.fn().mockResolvedValue([
                // Extra entries from prior chat context that should be dropped.
                { title: 'High Item One', confidence: 0.9, extractionIndex: 0, kind: 'vinyl' },
                { title: 'High Item Two', confidence: 0.9, extractionIndex: 1, kind: 'vinyl' },
                // Only this unresolved medium item should survive.
                { title: 'Medium Item', confidence: 0.9, extractionIndex: 2, kind: 'vinyl' },
            ]);

            const result = await service.processImage(
                'base64',
                { id: 28, type: 'vinyl' },
                100,
                {
                    rawItems: [
                        { title: 'High Item One', confidence: 0.98, extractionIndex: 0, box2d: [0.1, 0.1, 0.2, 0.2] },
                        { title: 'High Item Two', confidence: 0.95, extractionIndex: 1, box2d: [0.2, 0.2, 0.3, 0.3] },
                        { title: 'Medium Item', confidence: 0.86, extractionIndex: 2, box2d: [0.3, 0.3, 0.4, 0.4] },
                    ],
                },
            );

            expect(matchSpy).toHaveBeenCalledTimes(3);
            expect(lookupSpy).toHaveBeenCalledTimes(2);
            expect(saveToShelfSpy).toHaveBeenCalledTimes(2);
            // Step 4d medium save should only include the single unresolved medium item.
            expect(saveToShelfSpy.mock.calls[0][0]).toHaveLength(1);
            expect(saveToShelfSpy.mock.calls[0][0][0]).toEqual(expect.objectContaining({
                title: 'Medium Item',
                extractionIndex: 2,
            }));
            // Step 5 save should only include high-confidence resolved items.
            expect(saveToShelfSpy.mock.calls[1][0]).toHaveLength(2);
            expect(result.results.added).toBe(3);
        });
    });

    describe('source identity + region link guards', () => {
        it('skips duplicate source keys across save passes in the same scan run', async () => {
            const existingCollectable = { id: 99, title: 'Existing Book', kind: 'book' };
            shelvesQueries.addCollectable.mockResolvedValue({ id: 88 });

            const saveTracking = {
                savedSourceKeys: new Set(),
                firstLinkedRegionByCollectionItemId: new Map(),
                attemptedSaves: 0,
                savedUniqueRegions: 0,
                duplicateSourceSkipped: 0,
                duplicateRegionLinkSkipped: 0,
            };
            const hookContext = { scanPhotoId: 42, saveTracking };

            const first = await service.saveToShelf(
                [{ title: 'Existing Book', extractionIndex: 3, collectable: existingCollectable }],
                1,
                10,
                'book',
                hookContext,
            );
            const second = await service.saveToShelf(
                [{ title: 'Existing Book Duplicate', extractionIndex: 3, collectable: existingCollectable }],
                1,
                10,
                'book',
                hookContext,
            );

            expect(first.added).toHaveLength(1);
            expect(second.added).toHaveLength(0);
            expect(saveTracking.attemptedSaves).toBe(1);
            expect(saveTracking.savedUniqueRegions).toBe(1);
            expect(saveTracking.duplicateSourceSkipped).toBe(1);
            expect(shelvesQueries.addCollectable).toHaveBeenCalledTimes(1);
        });

        it('keeps first linked region for a collection item and skips later duplicates', async () => {
            const saveTracking = {
                savedSourceKeys: new Set(),
                firstLinkedRegionByCollectionItemId: new Map(),
                attemptedSaves: 0,
                savedUniqueRegions: 0,
                duplicateSourceSkipped: 0,
                duplicateRegionLinkSkipped: 0,
            };
            const hookContext = { scanPhotoId: 77, saveTracking };

            await service.linkRegionToCollectionItem({ extractionIndex: 3 }, 501, hookContext);
            await service.linkRegionToCollectionItem({ extractionIndex: 5 }, 501, hookContext);

            expect(visionItemRegionsQueries.linkCollectionItem).toHaveBeenCalledTimes(1);
            expect(visionItemRegionsQueries.linkCollectionItem).toHaveBeenCalledWith({
                scanPhotoId: 77,
                extractionIndex: 3,
                collectionItemId: 501,
            });
            expect(saveTracking.duplicateRegionLinkSkipped).toBe(1);
        });

        it('reuses first catalog-resolved write for duplicate OCR group keys', async () => {
            collectablesQueries.findByFingerprint.mockResolvedValue(null);
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
            collectablesQueries.findByFuzzyFingerprint.mockResolvedValue(null);
            collectablesQueries.upsert.mockResolvedValue({ id: 701, title: 'Shared Title', kind: 'book' });
            shelvesQueries.addCollectable.mockResolvedValue({ id: 1701 });

            const saveTracking = {
                savedSourceKeys: new Set(),
                firstLinkedRegionByCollectionItemId: new Map(),
                resolvedCatalogGroupReuse: new Map(),
                attemptedSaves: 0,
                savedUniqueRegions: 0,
                duplicateSourceSkipped: 0,
                duplicateRegionLinkSkipped: 0,
                groupReuseSkippedWrites: 0,
            };

            const result = await service.saveToShelf(
                [
                    { title: 'Shared Title', extractionIndex: 2, _skipRematch: true, _ocrGroupKey: 'shared|author' },
                    { title: 'Shared Title', extractionIndex: 3, _skipRematch: true, _ocrGroupKey: 'shared|author' },
                ],
                1,
                10,
                'book',
                { scanPhotoId: 55, saveTracking },
            );

            expect(collectablesQueries.upsert).toHaveBeenCalledTimes(1);
            expect(shelvesQueries.addCollectable).toHaveBeenCalledTimes(1);
            expect(saveTracking.groupReuseSkippedWrites).toBe(1);
            expect(result.added).toHaveLength(1);
        });

        it('replaces prior region link when a lower extraction index arrives later', async () => {
            const saveTracking = {
                savedSourceKeys: new Set(),
                firstLinkedRegionByCollectionItemId: new Map(),
                attemptedSaves: 0,
                savedUniqueRegions: 0,
                duplicateSourceSkipped: 0,
                duplicateRegionLinkSkipped: 0,
            };
            const hookContext = { scanPhotoId: 88, saveTracking };

            await service.linkRegionToCollectionItem({ extractionIndex: 9 }, 601, hookContext);
            await service.linkRegionToCollectionItem({ extractionIndex: 2 }, 601, hookContext);

            expect(visionItemRegionsQueries.clearCollectionItemLink).toHaveBeenCalledWith({
                scanPhotoId: 88,
                extractionIndex: 9,
            });
            expect(visionItemRegionsQueries.linkCollectionItem).toHaveBeenCalledTimes(2);
            expect(visionItemRegionsQueries.linkCollectionItem).toHaveBeenLastCalledWith({
                scanPhotoId: 88,
                extractionIndex: 2,
                collectionItemId: 601,
            });
            expect(saveTracking.firstLinkedRegionByCollectionItemId.get(601)).toBe(2);
        });
    });

    describe('strict movie/tv name matching', () => {
        beforeEach(() => {
            getVisionSettingsForType.mockReturnValue({
                nameSearchThreshold: 0.4,
                strictNameMatch: {
                    enabled: true,
                    candidateLimit: 3,
                    minSimilarity: 0.65,
                    minTokenJaccard: 0.55,
                    minTokenCoverage: 0.8,
                    minMargin: 0.08,
                },
            });
        });

        it('rejects semantically wrong near matches even with high trigram similarity', async () => {
            collectablesQueries.searchByTitle.mockResolvedValue([
                { id: 177, title: 'Jack Ryan 5-Film Collection', sim: 0.72 },
                { id: 900, title: 'Daniel Craig Bond Collection', sim: 0.66 },
                { id: 901, title: 'Top Gun: 2-Movie Collection', sim: 0.60 },
            ]);

            const result = await service.shelfTypeSecondaryLookup(
                { title: 'THE DANIEL CRAIG 5-FILM COLLECTION' },
                'movies',
                'unused',
            );

            expect(result).toBeNull();
        });

        it('rejects mismatched extended-edition collisions', async () => {
            collectablesQueries.searchByTitle.mockResolvedValue([
                { id: 1044, title: 'The Martian: Extended Edition', sim: 0.88 },
                { id: 777, title: 'The Revenant', sim: 0.84 },
                { id: 778, title: 'The Wizard of Oz', sim: 0.50 },
            ]);

            const result = await service.shelfTypeSecondaryLookup(
                { title: 'The Revenant Extended Edition' },
                'movies',
                'unused',
            );

            expect(result).toBeNull();
        });

        it('accepts minor OCR typos when strict score + token checks pass', async () => {
            collectablesQueries.searchByTitle.mockResolvedValue([
                { id: 1667, title: 'Mission: Impossible Ultimate Movie Collection', sim: 0.91 },
                { id: 1666, title: 'Top Gun: 2-Movie Collection', sim: 0.50 },
                { id: 1665, title: 'The Shawshank Redemption', sim: 0.41 },
            ]);

            const result = await service.shelfTypeSecondaryLookup(
                { title: 'Mission Impossible Ultmate Movie Collection' },
                'movies',
                'unused',
            );

            expect(result).toEqual(expect.objectContaining({
                id: 1667,
                title: 'Mission: Impossible Ultimate Movie Collection',
            }));
        });
    });

    describe('transaction safety', () => {
        beforeEach(() => {
            visionItemRegionsQueries.linkCollectable.mockClear();
            visionItemRegionsQueries.linkManual.mockClear();
            visionItemRegionsQueries.linkCollectionItem.mockClear();
            visionItemRegionsQueries.clearCollectionItemLink.mockClear();
        });

        it('saveToShelf wraps upsert+addCollectable in a transaction for new collectables', async () => {
            collectablesQueries.findByFingerprint.mockResolvedValue(null);
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
            collectablesQueries.findByFuzzyFingerprint.mockResolvedValue(null);
            collectablesQueries.upsert.mockResolvedValue({ id: 55, title: 'New Book', kind: 'book' });
            shelvesQueries.addCollectable.mockResolvedValue({ id: 77 });

            const items = [{ title: 'New Book', confidence: 1.0, kind: 'book', extractionIndex: 2 }];
            const result = await service.saveToShelf(items, 1, 10, 'book', { scanPhotoId: 15 });
            const added = result.added;

            expect(added).toHaveLength(1);
            expect(added[0].collectableId).toBe(55);
            expect(added[0].itemId).toBe(77);
            expect(result.failed).toEqual([]);
            expect(visionItemRegionsQueries.linkCollectable).toHaveBeenCalledWith({
                scanPhotoId: 15,
                extractionIndex: 2,
                collectableId: 55,
            });
            expect(visionItemRegionsQueries.linkCollectionItem).toHaveBeenCalledWith({
                scanPhotoId: 15,
                extractionIndex: 2,
                collectionItemId: 77,
            });
            // transaction() from pg mock should have been called
            expect(pg.transaction).toHaveBeenCalled();
            // upsert and addCollectable should have been called with the transaction client
            expect(collectablesQueries.upsert).toHaveBeenCalledWith(
                expect.any(Object),
                expect.any(Object) // the mock client
            );
            expect(shelvesQueries.addCollectable).toHaveBeenCalledWith(
                expect.objectContaining({ collectableId: 55 }),
                expect.any(Object) // the mock client
            );
        });

        it('saveToShelf does not use a transaction for pre-matched collectables', async () => {
            const existingCollectable = { id: 99, title: 'Existing Book', kind: 'book' };
            shelvesQueries.addCollectable.mockResolvedValue({ id: 88 });

            const items = [{ title: 'Existing Book', confidence: 1.0, collectable: existingCollectable }];
            const result = await service.saveToShelf(items, 1, 10, 'book');
            const added = result.added;

            expect(added).toHaveLength(1);
            expect(added[0].collectableId).toBe(99);
            expect(result.failed).toEqual([]);
            // upsert should NOT be called for pre-matched collectables
            expect(collectablesQueries.upsert).not.toHaveBeenCalled();
            // addCollectable should be called with only the params object (no client arg)
            expect(shelvesQueries.addCollectable).toHaveBeenCalledWith(
                expect.objectContaining({ collectableId: 99 })
            );
        });

        it('saveToShelf routes failed saves to review queue with reason save_error', async () => {
            const existingCollectable = { id: 99, title: 'Existing Book', kind: 'book' };
            shelvesQueries.addCollectable.mockRejectedValue(Object.assign(new Error('db exploded'), { code: 'XX001' }));
            const saveToReviewQueueSpy = jest
                .spyOn(service, 'saveToReviewQueue')
                .mockResolvedValue(undefined);

            const items = [{ title: 'Existing Book', confidence: 1.0, collectable: existingCollectable }];
            const result = await service.saveToShelf(items, 1, 10, 'book');

            expect(result.added).toEqual([]);
            expect(result.failed).toHaveLength(1);
            expect(result.failed[0]).toMatchObject({
                title: 'Existing Book',
                _saveError: expect.objectContaining({
                    code: 'XX001',
                    message: 'db exploded',
                }),
            });
            expect(saveToReviewQueueSpy).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        title: 'Existing Book',
                        _saveError: expect.objectContaining({ code: 'XX001' }),
                    }),
                ]),
                1,
                10,
                expect.objectContaining({ reason: 'save_error' }),
            );
            saveToReviewQueueSpy.mockRestore();
        });

        it('saveManualToShelf links region metadata to matched manual records', async () => {
            shelvesQueries.findManualByFingerprint.mockResolvedValue({ id: 501, name: 'Manual A', author: 'Author A' });
            shelvesQueries.findManualCollection.mockResolvedValue({ id: 901 });

            const result = await service.saveManualToShelf(
                [{ title: 'Manual A', author: 'Author A', extractionIndex: 3 }],
                1,
                10,
                'book',
                { requireCreator: true, hookContext: { scanPhotoId: 21 } },
            );

            expect(result.matched).toHaveLength(1);
            expect(visionItemRegionsQueries.linkManual).toHaveBeenCalledWith({
                scanPhotoId: 21,
                extractionIndex: 3,
                manualId: 501,
            });
            expect(visionItemRegionsQueries.linkCollectionItem).toHaveBeenCalledWith({
                scanPhotoId: 21,
                extractionIndex: 3,
                collectionItemId: 901,
            });
        });

        it('linkRegionToCollectionItem disables further writes when collection_item_id column is missing', async () => {
            const missingColumnErr = new Error('column "collection_item_id" of relation "vision_item_regions" does not exist');
            missingColumnErr.code = '42703';
            visionItemRegionsQueries.linkCollectionItem
                .mockRejectedValueOnce(missingColumnErr)
                .mockResolvedValue(null);

            await expect(
                service.linkRegionToCollectionItem(
                    { extractionIndex: 4 },
                    123,
                    { scanPhotoId: 88 },
                ),
            ).resolves.toBeUndefined();
            await expect(
                service.linkRegionToCollectionItem(
                    { extractionIndex: 5 },
                    124,
                    { scanPhotoId: 88 },
                ),
            ).resolves.toBeUndefined();

            expect(service.collectionItemRegionLinkAvailable).toBe(false);
            expect(visionItemRegionsQueries.linkCollectionItem).toHaveBeenCalledTimes(1);
            expect(visionItemRegionsQueries.linkCollectionItem).toHaveBeenCalledWith({
                scanPhotoId: 88,
                extractionIndex: 4,
                collectionItemId: 123,
            });
        });

        it('saveToReviewQueue wraps all inserts in a single transaction', async () => {
            needsReviewQueries.create.mockResolvedValue({ id: 1 });

            const items = [
                { title: 'Item A', confidence: 0.5 },
                { title: 'Item B', confidence: 0.6 },
            ];
            await service.saveToReviewQueue(items, 1, 10);

            expect(pg.transaction).toHaveBeenCalled();
            expect(needsReviewQueries.create).toHaveBeenCalledTimes(2);
            // Each create call should receive the transaction client
            expect(needsReviewQueries.create).toHaveBeenCalledWith(
                expect.objectContaining({ userId: 1, shelfId: 10 }),
                expect.any(Object) // the mock client
            );
        });

        it('saveToReviewQueue rolls back and sets reviewQueueAvailable=false when table is missing', async () => {
            const missingTableErr = new Error('relation "needs_review" does not exist');
            missingTableErr.code = '42P01';
            needsReviewQueries.create.mockRejectedValue(missingTableErr);

            const items = [{ title: 'Item A', confidence: 0.5 }];
            // Should not throw
            await expect(service.saveToReviewQueue(items, 1, 10)).resolves.toBeUndefined();
            expect(service.reviewQueueAvailable).toBe(false);
        });
    });

    describe('other shelf duplicate controls', () => {
        beforeEach(() => {
            shelvesQueries.findManualByFingerprint.mockResolvedValue(null);
            shelvesQueries.findManualByBarcode.mockResolvedValue(null);
            shelvesQueries.findManualCollection.mockResolvedValue(null);
            shelvesQueries.addManualCollection.mockResolvedValue({ id: 444 });
            shelvesQueries.addManual.mockResolvedValue({
                collection: { id: 333 },
                manual: { id: 222, name: 'Bottle A', author: 'Distillery' },
            });
            needsReviewQueries.create.mockResolvedValue({ id: 1 });
        });

        it('routes borderline fuzzy matches to review instead of creating duplicate manuals', async () => {
            mockGemini.detectShelfItemsFromImage.mockResolvedValue({
                items: [{ title: 'Weller Twelve', author: 'Buffalo Trace Distillery', confidence: 0.95 }],
            });
            shelvesQueries.fuzzyFindManualForOther.mockResolvedValue({
                id: 555,
                name: 'Weller 12',
                author: 'Buffalo Trace',
                titleSim: 0.86,
                creatorSim: 0.82,
                combinedSim: 0.85,
            });

            const result = await service.processImage('base64', { id: 9, type: 'other' }, 100);

            expect(result.results.added).toBe(0);
            expect(result.results.existing).toBe(0);
            expect(result.results.needsReview).toBe(1);
            expect(shelvesQueries.addManual).not.toHaveBeenCalled();
            expect(needsReviewQueries.create).toHaveBeenCalledTimes(1);
        });

        it('auto-merges high-confidence fuzzy matches as existing items', async () => {
            mockGemini.detectShelfItemsFromImage.mockResolvedValue({
                items: [{ title: 'Weller Twelve', author: 'Buffalo Trace Distillery', confidence: 0.95 }],
            });
            shelvesQueries.fuzzyFindManualForOther.mockResolvedValue({
                id: 777,
                name: 'Weller 12',
                author: 'Buffalo Trace',
                titleSim: 0.94,
                creatorSim: 0.91,
                combinedSim: 0.93,
            });
            shelvesQueries.findManualCollection.mockResolvedValue({ id: 901, manualId: 777 });

            const result = await service.processImage('base64', { id: 9, type: 'other' }, 100);

            expect(result.results.added).toBe(0);
            expect(result.results.existing).toBe(1);
            expect(result.results.needsReview).toBe(0);
            expect(shelvesQueries.addManual).not.toHaveBeenCalled();
            expect(needsReviewQueries.create).not.toHaveBeenCalled();
        });

        it('saves high-confidence other items without a creator when title meets the threshold', async () => {
            mockGemini.detectShelfItemsFromImage.mockResolvedValue({
                items: [{ title: 'Mystery Bottle', confidence: 0.95, extractionIndex: 0 }],
            });
            shelvesQueries.addManual.mockResolvedValue({
                collection: { id: 333 },
                manual: { id: 222, name: 'Mystery Bottle', author: null },
            });

            const result = await service.processImage('base64', { id: 9, type: 'other' }, 100);

            expect(result.results.added).toBe(1);
            expect(result.results.needsReview).toBe(0);
            expect(shelvesQueries.findManualByFingerprint).not.toHaveBeenCalled();
            expect(shelvesQueries.fuzzyFindManualForOther).not.toHaveBeenCalled();
            expect(shelvesQueries.addManual).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Mystery Bottle',
                    author: null,
                }),
            );
            expect(needsReviewQueries.create).not.toHaveBeenCalled();
        });

        it('skips creator-dependent matching but still uses barcode matching for title-only other items', async () => {
            shelvesQueries.findManualByBarcode.mockResolvedValue({ id: 555, name: 'Mystery Bottle', author: null });
            shelvesQueries.findManualCollection.mockResolvedValue({ id: 901, manualId: 555 });

            const result = await service.saveManualToShelf(
                [{ title: 'Mystery Bottle', barcode: '12345', extractionIndex: 1 }],
                1,
                10,
                'other',
                { requireCreator: false },
            );

            expect(shelvesQueries.findManualByFingerprint).not.toHaveBeenCalled();
            expect(shelvesQueries.fuzzyFindManualForOther).not.toHaveBeenCalled();
            expect(shelvesQueries.findManualByBarcode).toHaveBeenCalledWith({
                userId: 1,
                shelfId: 10,
                barcode: '12345',
            });
            expect(result.matched).toHaveLength(1);
            expect(result.matched[0]).toMatchObject({
                itemId: 901,
                manualId: 555,
            });
        });
    });

    describe('review queue context retention', () => {
        beforeEach(() => {
            shelvesQueries.findManualByFingerprint.mockResolvedValue(null);
            shelvesQueries.findManualByBarcode.mockResolvedValue(null);
            shelvesQueries.findManualCollection.mockResolvedValue(null);
            shelvesQueries.addManualCollection.mockResolvedValue({ id: 444 });
            shelvesQueries.addManual.mockResolvedValue({
                collection: { id: 333 },
                manual: { id: 222, name: 'Bottle A', author: 'Distillery' },
            });
            needsReviewQueries.create.mockResolvedValue({ id: 1 });
        });

        it('stores reviewContext for low-confidence items', async () => {
            mockGemini.detectShelfItemsFromImage.mockResolvedValue({
                items: [{ title: 'Blurry Bottle', confidence: 0.5, extractionIndex: 4 }],
            });

            await service.processImage('base64', { id: 9, type: 'other' }, 100, null, { scanPhotoId: 77 });

            expect(needsReviewQueries.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    rawData: expect.objectContaining({
                        title: 'Blurry Bottle',
                        reviewContext: expect.objectContaining({
                            scanPhotoId: 77,
                            extractionIndex: 4,
                            shelfType: 'other',
                            reason: 'low_confidence',
                        }),
                    }),
                }),
                expect.any(Object),
            );
        });

        it('stores reviewContext for missing-field review items', async () => {
            mockGemini.detectShelfItemsFromImage.mockResolvedValue({
                items: [{ title: '', author: 'Unknown Maker', confidence: 0.95, extractionIndex: 5 }],
            });

            await service.processImage('base64', { id: 9, type: 'other' }, 100, null, { scanPhotoId: 78 });

            expect(needsReviewQueries.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    rawData: expect.objectContaining({
                        author: 'Unknown Maker',
                        reviewContext: expect.objectContaining({
                            scanPhotoId: 78,
                            extractionIndex: 5,
                            shelfType: 'other',
                            reason: 'missing_fields',
                        }),
                    }),
                }),
                expect.any(Object),
            );
        });

        it('stores reviewContext for possible-duplicate review items', async () => {
            mockGemini.detectShelfItemsFromImage.mockResolvedValue({
                items: [{ title: 'Weller Twelve', author: 'Buffalo Trace Distillery', confidence: 0.95, extractionIndex: 6 }],
            });
            shelvesQueries.fuzzyFindManualForOther.mockResolvedValue({
                id: 555,
                name: 'Weller 12',
                author: 'Buffalo Trace',
                titleSim: 0.86,
                creatorSim: 0.82,
                combinedSim: 0.85,
            });

            await service.processImage('base64', { id: 9, type: 'other' }, 100, null, { scanPhotoId: 79 });

            expect(needsReviewQueries.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    rawData: expect.objectContaining({
                        duplicateReason: 'possible_duplicate',
                        reviewContext: expect.objectContaining({
                            scanPhotoId: 79,
                            extractionIndex: 6,
                            shelfType: 'other',
                            reason: 'possible_duplicate',
                        }),
                    }),
                }),
                expect.any(Object),
            );
        });
    });

    describe('scout pipeline review fixes', () => {
        it('routes multi-region sparse scout results through runSliceDetectionPhase', async () => {
            // Scout returns 2 sparse regions (shouldSlice false, but 2 regions)
            mockGemini.sendScoutPrompt.mockResolvedValue(JSON.stringify({
                full_image_estimated_item_count: 6,
                full_image_has_more_than_ten: false,
                regions: [
                    { region_box_2d: [0, 0, 500, 1000], confidence: 0.9, estimated_item_count: 3, has_more_than_ten: false },
                    { region_box_2d: [500, 0, 1000, 1000], confidence: 0.85, estimated_item_count: 3, has_more_than_ten: false },
                ],
            }));

            // Spy on runSliceDetectionPhase to verify it's called (not runSingleRegionDetection)
            // and return items from both regions
            const sliceSpy = jest.spyOn(service, 'runSliceDetectionPhase').mockResolvedValue({
                items: [
                    { title: 'Book A', confidence: 0.95 },
                    { title: 'Book B', confidence: 0.95 },
                ],
                warnings: [],
            });

            service.resolveCatalogServiceForShelf = jest.fn().mockReturnValue({
                search: jest.fn().mockResolvedValue([]),
            });
            mockGemini.enrichWithSchema.mockResolvedValue([
                { title: 'Book A', confidence: 0.95, kind: 'book' },
                { title: 'Book B', confidence: 0.95, kind: 'book' },
            ]);
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
            collectablesQueries.upsert.mockResolvedValue({ id: 200 });
            shelvesQueries.addCollectable.mockResolvedValue({ id: 300 });

            const result = await service.processImage('base64', { id: 1, type: 'book' }, 100);

            // runSliceDetectionPhase should be called (not runSingleRegionDetection)
            // This proves multi-region scouts route through the slice phase, not single-region
            expect(sliceSpy).toHaveBeenCalled();
            expect(result.results.added + result.results.needsReview).toBeGreaterThanOrEqual(1);
            sliceSpy.mockRestore();
        });

        it('falls back to legacy extraction when all slice/region extractions fail', async () => {
            // Scout returns a single dense region (shouldSlice true → routes to runSliceDetectionPhase)
            mockGemini.sendScoutPrompt.mockResolvedValue(JSON.stringify({
                full_image_estimated_item_count: 25,
                full_image_has_more_than_ten: true,
                regions: [{ region_box_2d: [0, 0, 1000, 1000], confidence: 0.9, estimated_item_count: 25, has_more_than_ten: true }],
            }));

            // Make runSliceDetectionPhase throw (simulating all extractions failed)
            const sliceSpy = jest.spyOn(service, 'runSliceDetectionPhase').mockRejectedValue(
                new Error('All 4 slice/region extractions failed. Falling back to legacy extraction.'),
            );

            // Legacy fallback via extractItems on full image should succeed
            mockGemini.detectShelfItemsFromImage.mockResolvedValue({
                items: [{ title: 'Fallback Book', confidence: 0.95 }],
            });
            service.resolveCatalogServiceForShelf = jest.fn().mockReturnValue({
                search: jest.fn().mockResolvedValue([]),
            });
            mockGemini.enrichWithSchema.mockResolvedValue([{ title: 'Fallback Book', confidence: 0.95, kind: 'book' }]);
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
            collectablesQueries.upsert.mockResolvedValue({ id: 201 });
            shelvesQueries.addCollectable.mockResolvedValue({ id: 301 });

            const result = await service.processImage('base64', { id: 1, type: 'book' }, 100);

            expect(sliceSpy).toHaveBeenCalled();
            // Legacy extraction should have produced results
            expect(mockGemini.detectShelfItemsFromImage).toHaveBeenCalled();
            expect(result.results.added + result.results.needsReview).toBeGreaterThanOrEqual(1);
            sliceSpy.mockRestore();
        });

        it('propagates WORKFLOW_ABORTED errors without falling back to legacy extraction', async () => {
            const abortError = new Error('WORKFLOW_ABORTED');
            abortError.code = 'WORKFLOW_ABORTED';
            mockGemini.sendScoutPrompt.mockRejectedValue(abortError);

            await expect(
                service.processImage('base64', { id: 1, type: 'book' }, 100),
            ).rejects.toThrow('WORKFLOW_ABORTED');

            // Legacy extraction should NOT have been called
            expect(mockGemini.detectShelfItemsFromImage).not.toHaveBeenCalled();
        });

        it('does not trigger legacy fallback when slice phase returns zero items with only warnings', async () => {
            // Scout returns dense region → routes to runSliceDetectionPhase
            mockGemini.sendScoutPrompt.mockResolvedValue(JSON.stringify({
                full_image_estimated_item_count: 20,
                full_image_has_more_than_ten: true,
                regions: [{ region_box_2d: [0, 0, 1000, 1000], confidence: 0.9, estimated_item_count: 20, has_more_than_ten: true }],
            }));

            // runSliceDetectionPhase succeeds but with zero items and a warning (not a throw)
            const sliceSpy = jest.spyOn(service, 'runSliceDetectionPhase').mockResolvedValue({
                items: [],
                warnings: ['Gemini returned truncated response for slice 2'],
            });

            service.resolveCatalogServiceForShelf = jest.fn().mockReturnValue({
                search: jest.fn().mockResolvedValue([]),
            });
            mockGemini.enrichWithSchema.mockResolvedValue([]);

            const result = await service.processImage('base64', { id: 1, type: 'book' }, 100);

            expect(sliceSpy).toHaveBeenCalled();
            // Legacy extractItems on full image should NOT have been called
            // (detectShelfItemsFromImage is called by extractItems; it should not fire here)
            expect(mockGemini.detectShelfItemsFromImage).not.toHaveBeenCalled();
            expect(result.results.added).toBe(0);
            sliceSpy.mockRestore();
        });

        it('scans all regions without slicing when VISION_SLICE_ENABLED is false (via shouldSliceRegion)', async () => {
            // Directly test runSliceDetectionPhase: pass a dense region but mock extractItems
            // to verify it calls extractItems per-region without slicing
            const scoutResult = {
                regions: [
                    { regionBox2d: [0, 0, 500, 1000], estimatedItemCount: 3, hasMoreThanTen: false, confidence: 0.9 },
                    { regionBox2d: [500, 0, 1000, 1000], estimatedItemCount: 4, hasMoreThanTen: false, confidence: 0.85 },
                ],
                shouldSlice: false,
            };

            // Mock extractItems to return items
            const extractSpy = jest.spyOn(service, 'extractItems')
                .mockResolvedValueOnce({ items: [{ title: 'Item A', confidence: 0.9, box2d: [100, 100, 400, 400] }] })
                .mockResolvedValueOnce({ items: [{ title: 'Item B', confidence: 0.85, box2d: [100, 100, 400, 400] }] });

            const result = await service.runSliceDetectionPhase(
                'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
                { type: 'book', description: null, name: 'My Shelf' },
                scoutResult,
                { width: 1200, height: 800 },
            );

            // Both regions should be processed (2 extractItems calls)
            expect(extractSpy).toHaveBeenCalledTimes(2);
            expect(result.items.length).toBe(2);
            extractSpy.mockRestore();
        });
    });

    describe('other shelf low-confidence second pass', () => {
        beforeEach(() => {
            service.saveToReviewQueue = jest.fn().mockResolvedValue(undefined);
            service.saveManualToShelf = jest.fn().mockResolvedValue({
                added: [{ itemId: 11, manualId: 22, title: 'Weller Twelve', primaryCreator: 'Buffalo Trace Distillery' }],
                matched: [],
                skipped: [],
                review: [],
            });
        });

        function buildDenseOtherItems({ count = 11, confidence = 0.55, titlePrefix = 'Item', boxBase = 100 } = {}) {
            return Array.from({ length: count }, (_, index) => ({
                title: `${titlePrefix} ${index}`,
                author: `Maker ${index}`,
                confidence,
                extractionIndex: index,
                box2d: [boxBase + index, 200 + index, 300 + index, 400 + index],
            }));
        }

        it('runs second pass for low-confidence other items and merges by extractionIndex', async () => {
            const priorConversationHistory = [
                { role: 'user', parts: [{ text: 'first pass prompt' }] },
                { role: 'model', parts: [{ text: 'first pass result' }] },
            ];
            mockGemini.detectShelfItemsFromImage
                .mockResolvedValueOnce({
                    items: [{
                        title: 'Weller Twlve',
                        author: 'Buffalo Trace Distillery',
                        confidence: 0.55,
                        extractionIndex: 0,
                        box2d: [100, 200, 300, 400],
                    }],
                    conversationHistory: priorConversationHistory,
                })
                .mockResolvedValueOnce({
                    items: [{
                        title: 'Weller Twelve',
                        author: 'Buffalo Trace Distillery',
                        confidence: 0.94,
                        extractionIndex: 0,
                        box2d: [5, 10, 15, 20],
                    }],
                });

            const result = await service.processImage('base64', { id: 9, type: 'other' }, 100);

            expect(mockGemini.detectShelfItemsFromImage).toHaveBeenCalledTimes(2);
            expect(mockGemini.detectShelfItemsFromImage).toHaveBeenNthCalledWith(
                2,
                'base64',
                'other',
                null,
                null,
                expect.objectContaining({
                    pass: 'second',
                    lowConfidenceItems: expect.arrayContaining([
                        expect.objectContaining({ extractionIndex: 0, confidence: 0.55 }),
                    ]),
                    conversationHistory: priorConversationHistory,
                }),
            );
            expect(service.saveManualToShelf).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        extractionIndex: 0,
                        title: 'Weller Twelve',
                        confidence: 0.94,
                        box2d: [100, 200, 300, 400],
                    }),
                ]),
                100,
                9,
                'other',
                expect.any(Object),
            );
            expect(service.saveToReviewQueue).not.toHaveBeenCalled();
            expect(result.results.needsReview).toBe(0);
        });

        it('normalizes slight first-pass provider overflow before matching and saving other items', async () => {
            mockGemini.detectShelfItemsFromImage.mockResolvedValue({
                items: [{
                    title: 'Overflow Item',
                    author: 'Maker Overflow',
                    confidence: 0.95,
                    extractionIndex: 0,
                    box_2d: [629, 993, 856, 1028],
                }],
            });

            await service.processImage('base64', { id: 9, type: 'other' }, 100);

            expect(service.saveManualToShelf).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        extractionIndex: 0,
                        title: 'Overflow Item',
                        box2d: [629, 993, 856, 1000],
                    }),
                ]),
                100,
                9,
                'other',
                expect.any(Object),
            );
        });

        it('runs dense box refinement before region persistence and falls back to original boxes when refinement is invalid', async () => {
            mockGemini.refineDenseItemBoxes = jest.fn().mockResolvedValue(new Map([
                [0, [111, 222, 333, 444]],
                [1, null],
            ]));
            mockGemini.detectShelfItemsFromImage
                .mockResolvedValueOnce({
                    items: buildDenseOtherItems(),
                })
                .mockResolvedValueOnce({
                    items: [],
                });

            await service.processImage(
                'base64',
                { id: 9, type: 'other' },
                100,
                'job-dense-persist',
                { scanPhotoId: 77 },
            );

            expect(mockGemini.refineDenseItemBoxes).toHaveBeenCalledWith(
                'base64',
                'other',
                expect.arrayContaining([
                    expect.objectContaining({ extractionIndex: 0 }),
                    expect.objectContaining({ extractionIndex: 10 }),
                ]),
                null,
                { batchSize: 8 },
            );
            expect(visionItemRegionsQueries.upsertRegionsForScan).toHaveBeenCalledWith({
                userId: 100,
                shelfId: 9,
                scanPhotoId: 77,
                replaceExisting: true,
                regions: expect.arrayContaining([
                    expect.objectContaining({
                        extractionIndex: 0,
                        box2d: [111, 222, 333, 444],
                    }),
                    expect.objectContaining({
                        extractionIndex: 1,
                        box2d: [101, 201, 301, 401],
                    }),
                ]),
            });
        });

        it('skips dense box refinement when item count does not exceed the threshold', async () => {
            mockGemini.refineDenseItemBoxes = jest.fn().mockResolvedValue(new Map());
            mockGemini.detectShelfItemsFromImage
                .mockResolvedValueOnce({
                    items: buildDenseOtherItems({ count: 10 }),
                })
                .mockResolvedValueOnce({
                    items: [],
                });

            await service.processImage(
                'base64',
                { id: 9, type: 'other' },
                100,
                'job-dense-skip',
                { scanPhotoId: 78 },
            );

            expect(mockGemini.refineDenseItemBoxes).not.toHaveBeenCalled();
        });

        it('keeps refined first-pass boxes when second-pass metadata returns different box values', async () => {
            mockGemini.refineDenseItemBoxes = jest.fn().mockResolvedValue(new Map([
                [0, [111, 222, 333, 444]],
            ]));
            mockGemini.detectShelfItemsFromImage
                .mockResolvedValueOnce({
                    items: buildDenseOtherItems(),
                })
                .mockResolvedValueOnce({
                    items: buildDenseOtherItems({ confidence: 0.94, boxBase: 5, titlePrefix: 'Corrected Item' }),
                });

            await service.processImage('base64', { id: 9, type: 'other' }, 100);

            expect(service.saveManualToShelf).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        extractionIndex: 0,
                        title: 'Corrected Item 0',
                        confidence: 0.94,
                        box2d: [111, 222, 333, 444],
                    }),
                ]),
                100,
                9,
                'other',
                expect.any(Object),
            );
        });

        it('ignores unmatched second-pass indexes and keeps first-pass low-confidence items in review', async () => {
            service.saveManualToShelf = jest.fn().mockResolvedValue({
                added: [],
                matched: [],
                skipped: [],
                review: [],
            });

            mockGemini.detectShelfItemsFromImage
                .mockResolvedValueOnce({
                    items: [{ title: 'Weller Twlve', author: 'Buffalo Trace Distillery', confidence: 0.55, extractionIndex: 0 }],
                })
                .mockResolvedValueOnce({
                    items: [{ title: 'Different Item', author: 'Other Maker', confidence: 0.95, extractionIndex: 99 }],
                });

            const result = await service.processImage('base64', { id: 9, type: 'other' }, 100);

            expect(mockGemini.detectShelfItemsFromImage).toHaveBeenCalledTimes(2);
            expect(service.saveToReviewQueue).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ extractionIndex: 0, confidence: 0.55 }),
                ]),
                100,
                9,
                expect.objectContaining({ reason: 'low_confidence' }),
            );
            expect(service.saveManualToShelf).toHaveBeenCalledWith(
                [],
                100,
                9,
                'other',
                expect.any(Object),
            );
            expect(result.results.needsReview).toBe(1);
        });

        it('keeps first-pass confidence when second-pass confidence was not provided by model', async () => {
            service.saveManualToShelf = jest.fn().mockResolvedValue({
                added: [],
                matched: [],
                skipped: [],
                review: [],
            });
            mockGemini.detectShelfItemsFromImage
                .mockResolvedValueOnce({
                    items: [{ title: 'Weller Twlve', author: 'Buffalo Trace Distillery', confidence: 0.55, extractionIndex: 0 }],
                })
                .mockResolvedValueOnce({
                    items: [{
                        title: 'Weller Twelve',
                        author: 'Buffalo Trace Distillery',
                        confidence: 0.7,
                        confidenceProvided: false,
                        extractionIndex: 0,
                    }],
                });

            const result = await service.processImage('base64', { id: 9, type: 'other' }, 100);

            expect(service.saveToReviewQueue).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ extractionIndex: 0, confidence: 0.55 }),
                ]),
                100,
                9,
                expect.objectContaining({ reason: 'low_confidence' }),
            );
            expect(service.saveManualToShelf).toHaveBeenCalledWith(
                [],
                100,
                9,
                'other',
                expect.any(Object),
            );
            expect(result.results.needsReview).toBe(1);
        });

        it('uses dedicated second-pass progress stages so other scans do not regress to 10%', async () => {
            const updateJobSpy = jest.spyOn(processingStatus, 'updateJob');
            mockGemini.detectShelfItemsFromImage
                .mockResolvedValueOnce({
                    items: [{ title: 'Weller Twlve', author: 'Buffalo Trace Distillery', confidence: 0.55, extractionIndex: 0 }],
                })
                .mockResolvedValueOnce({
                    items: [{ title: 'Weller Twelve', author: 'Buffalo Trace Distillery', confidence: 0.94, extractionIndex: 0 }],
                });

            await service.processImage('base64', { id: 9, type: 'other' }, 100, 'job-progress');

            const updates = updateJobSpy.mock.calls.map((call) => call[1] || {});
            const steps = updates.map((entry) => entry.step).filter(Boolean);
            expect(steps).toEqual(expect.arrayContaining([
                'extracting',
                'categorizing',
                'extracting-second-pass',
                'matching-other',
                'preparing-other',
                'saving',
            ]));

            const secondPassStepIndex = steps.indexOf('extracting-second-pass');
            const matchingStepIndex = steps.indexOf('matching-other');
            expect(secondPassStepIndex).toBeGreaterThan(-1);
            expect(matchingStepIndex).toBeGreaterThan(secondPassStepIndex);

            const secondPassProgress = updates
                .filter((entry) => entry.step === 'extracting-second-pass')
                .map((entry) => entry.progress);
            expect(secondPassProgress).toEqual(expect.arrayContaining([55]));

            updateJobSpy.mockRestore();
        });

        it('emits the dense box refinement progress stage for crowded other-shelf scans', async () => {
            const updateJobSpy = jest.spyOn(processingStatus, 'updateJob');
            mockGemini.refineDenseItemBoxes = jest.fn().mockResolvedValue(new Map());
            mockGemini.detectShelfItemsFromImage
                .mockResolvedValueOnce({
                    items: buildDenseOtherItems(),
                })
                .mockResolvedValueOnce({
                    items: [],
                });

            await service.processImage('base64', { id: 9, type: 'other' }, 100, 'job-dense-progress');

            const updates = updateJobSpy.mock.calls.map((call) => call[1] || {});
            const steps = updates.map((entry) => entry.step).filter(Boolean);
            expect(steps).toEqual(expect.arrayContaining([
                'extracting',
                'refining-dense-boxes',
                'categorizing',
                'extracting-second-pass',
            ]));

            const refineProgress = updates
                .filter((entry) => entry.step === 'refining-dense-boxes')
                .map((entry) => entry.progress);
            expect(refineProgress).toEqual(expect.arrayContaining([35]));
            expect(steps.indexOf('refining-dense-boxes')).toBeLessThan(steps.indexOf('categorizing'));

            updateJobSpy.mockRestore();
        });

        it('emits extraction heartbeat progress stages while OCR extraction is still running', async () => {
            jest.useFakeTimers();
            const updateJobSpy = jest.spyOn(processingStatus, 'updateJob');
            let resolveExtraction;
            const extractionPromise = new Promise((resolve) => {
                resolveExtraction = resolve;
            });
            mockGemini.detectShelfItemsFromImage.mockReturnValue(extractionPromise);

            try {
                const processPromise = service.processImage('base64', { id: 11, type: 'book' }, 100, 'job-heartbeat');
                // Flush microtask queue to allow scout phase and extraction setup to complete
                for (let i = 0; i < 10; i += 1) await Promise.resolve();

                jest.advanceTimersByTime(3000);
                await Promise.resolve();

                let heartbeatSteps = updateJobSpy.mock.calls
                    .map((call) => call[1]?.step)
                    .filter((step) => step === 'extracting-in-flight' || step === 'extracting-deep-parse');
                expect(heartbeatSteps).toEqual(expect.arrayContaining(['extracting-in-flight']));

                jest.advanceTimersByTime(6000);
                await Promise.resolve();

                heartbeatSteps = updateJobSpy.mock.calls
                    .map((call) => call[1]?.step)
                    .filter((step) => step === 'extracting-in-flight' || step === 'extracting-deep-parse');
                expect(heartbeatSteps).toEqual(expect.arrayContaining(['extracting-in-flight', 'extracting-deep-parse']));
                expect(heartbeatSteps.filter((step) => step === 'extracting-in-flight')).toHaveLength(1);
                expect(heartbeatSteps.filter((step) => step === 'extracting-deep-parse')).toHaveLength(1);

                resolveExtraction({ items: [] });
                await processPromise;
            } finally {
                updateJobSpy.mockRestore();
                jest.useRealTimers();
            }
        });

        it('does not emit extraction heartbeat stages when OCR extraction finishes quickly', async () => {
            jest.useFakeTimers();
            const updateJobSpy = jest.spyOn(processingStatus, 'updateJob');
            mockGemini.detectShelfItemsFromImage.mockResolvedValue({ items: [] });

            try {
                await service.processImage('base64', { id: 12, type: 'book' }, 100, 'job-fast');
                jest.runOnlyPendingTimers();

                const heartbeatSteps = updateJobSpy.mock.calls
                    .map((call) => call[1]?.step)
                    .filter((step) => step === 'extracting-in-flight' || step === 'extracting-deep-parse');
                expect(heartbeatSteps).toHaveLength(0);
            } finally {
                updateJobSpy.mockRestore();
                jest.useRealTimers();
            }
        });
    });
});
