const shelvesController = require('../controllers/shelvesController');
const { VisionPipelineService } = require('../services/visionPipeline');
const shelvesQueries = require('../database/queries/shelves');
const visionResultCacheQueries = require('../database/queries/visionResultCache');
const needsReviewQueries = require('../database/queries/needsReview');
const collectablesQueries = require('../database/queries/collectables');

jest.mock('../services/visionPipeline');
jest.mock('../database/queries/shelves');
jest.mock('../database/queries/visionResultCache', () => ({
    getValid: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(null),
}));
jest.mock('../database/queries/needsReview');
jest.mock('../database/queries/collectables');
jest.mock('../services/processingStatus', () => ({
    generateJobId: jest.fn(() => 'test-job-id'),
    createJob: jest.fn(),
    updateJob: jest.fn(),
    completeJob: jest.fn(),
    failJob: jest.fn(),
    isAborted: jest.fn(() => false),
    getJob: jest.fn(),
    abortJob: jest.fn(),
}));
jest.mock('../database/queries/visionQuota', () => ({
    getQuota: jest.fn().mockResolvedValue({
        scansUsed: 0,
        scansRemaining: 50,
        monthlyLimit: 50,
        periodStart: new Date().toISOString(),
        daysRemaining: 30,
    }),
    incrementUsage: jest.fn().mockResolvedValue({ scansUsed: 1, scansRemaining: 49, monthlyLimit: 50 }),
}));

describe('shelvesController', () => {
    let req, res;
    let mockPipelineInstance;

    beforeEach(() => {
        req = {
            user: { id: 1, isPremium: true },
            params: { shelfId: '10' },
            body: {
                imageBase64: 'data:image/jpeg;base64,aabbcc',
                async: false, // Use synchronous mode for predictable test assertions
            }
        };
        res = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        };

        mockPipelineInstance = {
            processImage: jest.fn().mockResolvedValue({
                analysis: {},
                results: { added: 0, needsReview: 0 },
                addedItems: [],
                needsReview: []
            })
        };
        VisionPipelineService.mockImplementation(() => mockPipelineInstance);

        // Mock loadShelfForUser via the query it calls? 
        // Controller calls loadShelfForUser which calls shelvesQueries.getById
        shelvesQueries.getById.mockResolvedValue({ id: 10, type: 'book' });
        shelvesQueries.getItems.mockResolvedValue([]);
        visionResultCacheQueries.getValid.mockResolvedValue(null);
        needsReviewQueries.getById.mockResolvedValue(null);
        needsReviewQueries.markCompleted.mockResolvedValue(true);
        collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
    });

    describe('processShelfVision', () => {
        it('should return 403 if user is not premium', async () => {
            req.user.isPremium = false;
            await shelvesController.processShelfVision(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requiresPremium: true }));
        });

        it('should return 400 if imageBase64 is missing', async () => {
            req.body.imageBase64 = null;
            await shelvesController.processShelfVision(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('should call vision pipeline and return structured results', async () => {
            await shelvesController.processShelfVision(req, res);

            expect(mockPipelineInstance.processImage).toHaveBeenCalledWith(
                'data:image/jpeg;base64,aabbcc',
                expect.objectContaining({ id: 10 }),
                1,
                expect.any(String),
                null
            );
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                visionStatus: { status: 'completed', provider: 'google-vision-gemini-pipeline' }
            }));
        });

        it('should include hydrated shelf items in response', async () => {
            // getItems returns rows that are processed by formatShelfItem
            // Verify that items array is present in the response (hydration occurred)
            await shelvesController.processShelfVision(req, res);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                items: expect.any(Array)
            }));
            expect(shelvesQueries.getItems).toHaveBeenCalled();
        });

        it('returns cached result and skips pipeline processing when image hash matches', async () => {
            visionResultCacheQueries.getValid.mockResolvedValue({
                resultJson: {
                    analysis: { shelfConfirmed: true },
                    results: { added: 0, existing: 2, needsReview: 0, extracted: 2 },
                    addedItems: [],
                    needsReview: [],
                },
            });

            await shelvesController.processShelfVision(req, res);

            expect(mockPipelineInstance.processImage).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                cached: true,
                existingCount: 2,
                summaryMessage: 'Same photo detected: this image was already scanned in the last 24 hours. Previous result: no new items added; 2 items already on this shelf.',
            }));
        });
    });

    describe('processCatalogLookup', () => {
        beforeEach(() => {
            req.body = {
                items: [
                    { name: 'Dune', author: 'Frank Herbert', type: 'book' },
                    { name: 'Foundation', author: 'Isaac Asimov', type: 'book' },
                ],
            };
        });

        it('should return 404 if shelf is not found', async () => {
            shelvesQueries.getById.mockResolvedValue(null);
            await shelvesController.processCatalogLookup(req, res);
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Shelf not found' });
        });

        it('should return 400 if items array is missing', async () => {
            req.body = {};
            await shelvesController.processCatalogLookup(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'items array is required' });
        });

        it('should return 400 if items array is empty', async () => {
            req.body = { items: [] };
            await shelvesController.processCatalogLookup(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'items array is required' });
        });

        it('should call pipeline.processImage with null imageBase64 and rawItems option', async () => {
            await shelvesController.processCatalogLookup(req, res);

            expect(mockPipelineInstance.processImage).toHaveBeenCalledWith(
                null,
                expect.objectContaining({ id: 10, type: 'book' }),
                1,
                null,
                expect.objectContaining({
                    rawItems: expect.any(Array),
                    ocrProvider: 'mlkit',
                })
            );
        });

        it('should normalize name -> title and set kind from shelf type with confidence 1.0', async () => {
            await shelvesController.processCatalogLookup(req, res);

            const callArgs = mockPipelineInstance.processImage.mock.calls[0];
            const passedOptions = callArgs[4];
            expect(passedOptions.rawItems).toEqual([
                { title: 'Dune', author: 'Frank Herbert', kind: 'book', confidence: 1.0 },
                { title: 'Foundation', author: 'Isaac Asimov', kind: 'book', confidence: 1.0 },
            ]);
        });

        it('should return completion counts, summary, analysis, and hydrated items', async () => {
            mockPipelineInstance.processImage.mockResolvedValue({
                analysis: { shelfConfirmed: true },
                addedItems: [{ id: 1 }, { id: 2 }],
                needsReview: [{ id: 3 }],
            });

            await shelvesController.processCatalogLookup(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                addedCount: 2,
                needsReviewCount: 1,
                existingCount: 0,
                extractedCount: 0,
                summaryMessage: expect.any(String),
                analysis: { shelfConfirmed: true },
                items: expect.any(Array),
            }));
        });

        it('should return a duplicate-aware summary when items already exist on shelf', async () => {
            mockPipelineInstance.processImage.mockResolvedValue({
                analysis: { shelfConfirmed: true, items: [{ id: 'a' }, { id: 'b' }] },
                results: { added: 0, existing: 2, needsReview: 0, extracted: 2 },
                addedItems: [],
                needsReview: [],
            });

            await shelvesController.processCatalogLookup(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                addedCount: 0,
                existingCount: 2,
                extractedCount: 2,
                needsReviewCount: 0,
                summaryMessage: 'Scan complete: no new items added; 2 items already on this shelf.',
                items: expect.any(Array),
            }));
        });

        it('should handle pipeline result with no addedItems or needsReview gracefully', async () => {
            mockPipelineInstance.processImage.mockResolvedValue({
                analysis: null,
                addedItems: undefined,
                needsReview: undefined,
            });

            await shelvesController.processCatalogLookup(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                addedCount: 0,
                needsReviewCount: 0,
            }));
        });

        it('should return 500 if pipeline throws', async () => {
            mockPipelineInstance.processImage.mockRejectedValue(new Error('pipeline error'));
            await shelvesController.processCatalogLookup(req, res);
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: 'Catalog lookup failed' });
        });

        it('should use title field if name is absent', async () => {
            req.body = {
                items: [{ title: 'Neuromancer', author: 'William Gibson', type: 'book' }],
            };

            await shelvesController.processCatalogLookup(req, res);

            const callArgs = mockPipelineInstance.processImage.mock.calls[0];
            const passedOptions = callArgs[4];
            expect(passedOptions.rawItems[0].title).toBe('Neuromancer');
        });
    });

    describe('completeReviewItem', () => {
        it('reuses fuzzy-review manual match for other shelves instead of creating duplicate manual rows', async () => {
            req.params = { shelfId: '10', id: '55' };
            req.body = {};
            shelvesQueries.getById.mockResolvedValue({ id: 10, type: 'other' });
            needsReviewQueries.getById.mockResolvedValue({
                id: 55,
                shelfId: 10,
                rawData: {
                    title: 'Weller Twelve',
                    author: 'Buffalo Trace Distillery',
                },
            });
            shelvesQueries.findManualByFingerprint.mockResolvedValue(null);
            shelvesQueries.findManualByBarcode.mockResolvedValue(null);
            shelvesQueries.fuzzyFindManualForOther.mockResolvedValue({
                id: 701,
                name: 'Weller 12',
                author: 'Buffalo Trace',
                titleSim: 0.86,
                creatorSim: 0.84,
                combinedSim: 0.85,
            });
            shelvesQueries.findManualCollection.mockResolvedValue({
                id: 999,
                position: null,
                format: null,
                notes: null,
                rating: null,
            });

            await shelvesController.completeReviewItem(req, res);

            expect(shelvesQueries.addManual).not.toHaveBeenCalled();
            expect(needsReviewQueries.markCompleted).toHaveBeenCalledWith(55, 1);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                item: expect.objectContaining({
                    id: 999,
                    manual: expect.objectContaining({ id: 701 }),
                }),
            }));
        });
    });
});
