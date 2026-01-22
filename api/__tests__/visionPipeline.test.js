const { VisionPipelineService } = require('../services/visionPipeline');
const { GoogleGeminiService } = require('../services/googleGemini');
const collectablesQueries = require('../database/queries/collectables');
const needsReviewQueries = require('../database/queries/needsReview');
const shelvesQueries = require('../database/queries/shelves');

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
});
