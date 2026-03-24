const { VisionPipelineService } = require('../services/visionPipeline');
const { GoogleGeminiService } = require('../services/googleGemini');
const collectablesQueries = require('../database/queries/collectables');
const needsReviewQueries = require('../database/queries/needsReview');
const shelvesQueries = require('../database/queries/shelves');
const visionItemRegionsQueries = require('../database/queries/visionItemRegions');
const pg = require('../database/pg');

jest.mock('../services/googleGemini');
jest.mock('../database/queries/collectables');
jest.mock('../database/queries/needsReview');
jest.mock('../database/queries/shelves');
jest.mock('../database/queries/visionItemRegions', () => ({
    upsertRegionsForScan: jest.fn().mockResolvedValue([]),
    linkCollectable: jest.fn().mockResolvedValue(null),
    linkManual: jest.fn().mockResolvedValue(null),
    linkCollectionItem: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/collectables/fingerprint', () => ({
    makeLightweightFingerprint: jest.fn(item => 'fingerprint-' + item.title),
    makeVisionOcrFingerprint: jest.fn(() => 'ocr-fingerprint'),
    makeCollectableFingerprint: jest.fn(() => 'collectable-fingerprint'),
    makeManualFingerprint: jest.fn(() => 'manual-fingerprint'),
}));
jest.mock('../services/catalog/BookCatalogService');

describe('VisionPipelineService', () => {
    let service;
    let mockGemini;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new VisionPipelineService();
        mockGemini = GoogleGeminiService.mock.instances[0];
        mockGemini.detectShelfItemsFromImage = jest.fn();
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
    });

    describe('medium enrichment dedupe guards', () => {
        it('keeps medium enrichment scoped to unresolved medium items when chat continuation returns extra entries', async () => {
            const saveToShelfSpy = jest.spyOn(service, 'saveToShelf').mockImplementation(async (items) => ({
                added: items.map((item, index) => ({
                    ...item,
                    itemId: index + 1,
                    collectableId: index + 100,
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

    describe('transaction safety', () => {
        beforeEach(() => {
            visionItemRegionsQueries.linkCollectable.mockClear();
            visionItemRegionsQueries.linkManual.mockClear();
            visionItemRegionsQueries.linkCollectionItem.mockClear();
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
    });
});
