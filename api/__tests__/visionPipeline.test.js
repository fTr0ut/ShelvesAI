const { VisionPipelineService } = require('../services/visionPipeline');
const { GoogleGeminiService } = require('../services/googleGemini');
const collectablesQueries = require('../database/queries/collectables');
const needsReviewQueries = require('../database/queries/needsReview');
const shelvesQueries = require('../database/queries/shelves');
const pg = require('../database/pg');

jest.mock('../services/googleGemini');
jest.mock('../database/queries/collectables');
jest.mock('../database/queries/needsReview');
jest.mock('../database/queries/shelves');
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

    describe('transaction safety', () => {
        it('saveToShelf wraps upsert+addCollectable in a transaction for new collectables', async () => {
            collectablesQueries.findByFingerprint.mockResolvedValue(null);
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
            collectablesQueries.findByFuzzyFingerprint.mockResolvedValue(null);
            collectablesQueries.upsert.mockResolvedValue({ id: 55, title: 'New Book', kind: 'book' });
            shelvesQueries.addCollectable.mockResolvedValue({ id: 77 });

            const items = [{ title: 'New Book', confidence: 1.0, kind: 'book' }];
            const added = await service.saveToShelf(items, 1, 10, 'book');

            expect(added).toHaveLength(1);
            expect(added[0].collectableId).toBe(55);
            expect(added[0].itemId).toBe(77);
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
            const added = await service.saveToShelf(items, 1, 10, 'book');

            expect(added).toHaveLength(1);
            expect(added[0].collectableId).toBe(99);
            // upsert should NOT be called for pre-matched collectables
            expect(collectablesQueries.upsert).not.toHaveBeenCalled();
            // addCollectable should be called with only the params object (no client arg)
            expect(shelvesQueries.addCollectable).toHaveBeenCalledWith(
                expect.objectContaining({ collectableId: 99 })
            );
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
});
