jest.mock('../services/catalog/sharedCatalogServices', () => ({
  getSharedCatalogServices: jest.fn(),
}));

jest.mock('../services/catalog/MetadataScorer', () => ({
  getMetadataScorer: jest.fn(),
}));

const { getSharedCatalogServices } = require('../services/catalog/sharedCatalogServices');
const { getMetadataScorer } = require('../services/catalog/MetadataScorer');
const { CollectableMatchingService } = require('../services/collectableMatchingService');

function makeCatalogService(supportedType) {
  return {
    supportsShelfType: jest.fn((type) => type === supportedType),
    safeLookupMany: jest.fn().mockResolvedValue([]),
  };
}

describe('CollectableMatchingService', () => {
  let sharedServices;
  let tvCatalogService;

  beforeEach(() => {
    tvCatalogService = makeCatalogService('tv');
    sharedServices = {
      book: makeCatalogService('books'),
      game: makeCatalogService('games'),
      movie: makeCatalogService('movies'),
      music: makeCatalogService('vinyl'),
      tv: tvCatalogService,
    };

    getSharedCatalogServices.mockReturnValue(sharedServices);
    getMetadataScorer.mockReturnValue({
      scoreAsync: jest.fn().mockResolvedValue({ score: 73, missing: [] }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolves tv catalog service', () => {
    const service = new CollectableMatchingService();
    expect(service.resolveCatalogService('tv')).toBe(tvCatalogService);
  });

  it('searches tv API container with multiple results lookup', async () => {
    tvCatalogService.safeLookupMany.mockResolvedValueOnce([
      {
        title: 'Severance',
        kind: 'tv',
        provider: 'tmdb-tv',
      },
    ]);

    const service = new CollectableMatchingService();
    const results = await service.searchCatalogAPIMultiple(
      { title: 'Severance' },
      'tv',
      { limit: 3 },
    );

    expect(tvCatalogService.safeLookupMany).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Severance',
        name: 'Severance',
      }),
      3,
      undefined,
      { offset: 0 },
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'Severance',
      kind: 'tv',
      fromApi: true,
      matchSource: 'api',
      _metadataScore: 73,
    });
  });
});
