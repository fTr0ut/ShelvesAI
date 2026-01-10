const { VisionPipelineService } = require('../services/visionPipeline');
const { BookCatalogService } = require('../services/catalog/BookCatalogService');
const { GameCatalogService } = require('../services/catalog/GameCatalogService');
const { MovieCatalogService } = require('../services/catalog/MovieCatalogService');

// Mock dependencies
jest.mock('../services/catalog/BookCatalogService');
jest.mock('../services/catalog/GameCatalogService');
jest.mock('../services/catalog/MovieCatalogService');
jest.mock('../services/googleCloudVision');
jest.mock('../services/googleGemini');
jest.mock('../database/queries/collectables');
jest.mock('../database/queries/needsReview');
jest.mock('../database/queries/shelves');
jest.mock('../services/collectables/fingerprint', () => ({
    makeLightweightFingerprint: jest.fn(() => 'mock-fingerprint')
}));

describe('Catalog Integration in VisionPipeline', () => {
    let pipeline;
    let mockBookService, mockGameService, mockMovieService;

    beforeEach(() => {
        // Clear mocks
        jest.clearAllMocks();

        // Setup service mocks
        mockBookService = {
            supportsShelfType: jest.fn(type => ['book', 'books'].includes(type)),
            lookupFirstPass: jest.fn(),
            search: jest.fn() // Add search mock if pipeline uses it directly (it was implemented to use search in loop)
        };
        mockGameService = {
            supportsShelfType: jest.fn(type => ['game'].includes(type)),
            search: jest.fn()
        };
        mockMovieService = {
            supportsShelfType: jest.fn(type => ['movie'].includes(type)),
            search: jest.fn()
        };

        BookCatalogService.mockImplementation(() => mockBookService);
        GameCatalogService.mockImplementation(() => mockGameService);
        MovieCatalogService.mockImplementation(() => mockMovieService);

        pipeline = new VisionPipelineService();
    });

    describe('Service Resolution', () => {
        it('should resolve BookCatalogService for "book" type', () => {
            const service = pipeline.resolveCatalogServiceForShelf('book');
            expect(service).toBeDefined();
            // Verify it returns our injected mock
            expect(service).toBe(mockBookService);
        });

        it('should resolve GameCatalogService for "game" type', () => {
            const service = pipeline.resolveCatalogServiceForShelf('game');
            expect(service).toBe(mockGameService);
        });
    });

    describe('Lookup Logic', () => {
        it('should use catalog service to resolve items', async () => {
            const spySearch = jest.fn().mockResolvedValue([{
                title: 'Harry Potter',
                authors: ['J.K. Rowling'],
                id: 'OL123',
                publishedDate: '1997'
            }]);

            // Inject spy into the instance attached to pipeline
            pipeline.catalogs.book.search = spySearch;

            const items = [{ title: 'Harry Potter' }];
            const result = await pipeline.lookupCatalog(items, 'book');

            expect(spySearch).toHaveBeenCalledWith('Harry Potter');
            expect(result.resolved).toHaveLength(1);
            expect(result.unresolved).toHaveLength(0);
            expect(result.resolved[0].source).toBe('catalog-match');
            expect(result.resolved[0].confidence).toBe(1.0);
        });

        it('should handle catalog misses', async () => {
            const spySearch = jest.fn().mockResolvedValue([]);
            pipeline.catalogs.book.search = spySearch;

            const items = [{ title: 'Unknown Book' }];
            const result = await pipeline.lookupCatalog(items, 'book');

            expect(result.resolved).toHaveLength(0);
            expect(result.unresolved).toHaveLength(1);
        });

        it('should handle rate limits/errors gracefully by treating as unresolved', async () => {
            const spySearch = jest.fn().mockRejectedValue(new Error('Rate limit'));
            pipeline.catalogs.game.search = spySearch;

            const items = [{ title: 'Half-Life 3' }];
            const result = await pipeline.lookupCatalog(items, 'game');

            expect(result.resolved).toHaveLength(0);
            expect(result.unresolved).toHaveLength(1);
        });
    });
});
