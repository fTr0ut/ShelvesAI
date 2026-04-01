jest.mock('../openLibrary', () => ({
  lookupWorkBookMetadata: jest.fn(),
  searchAndHydrateBooks: jest.fn(),
  lookupWorkByISBN: jest.fn(),
}));

jest.mock('./CatalogRouter', () => ({
  getCatalogRouter: jest.fn(),
}));

jest.mock('../../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { BookCatalogService } = require('./BookCatalogService');
const { searchAndHydrateBooks } = require('../openLibrary');
const { getCatalogRouter } = require('./CatalogRouter');

describe('BookCatalogService.safeLookupMany', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty when both title and author are missing', async () => {
    const service = new BookCatalogService();
    const results = await service.safeLookupMany({}, 5, 0, { offset: 10 });

    expect(results).toEqual([]);
    expect(searchAndHydrateBooks).not.toHaveBeenCalled();
  });

  it('passes limit/offset to OpenLibrary and maps provider metadata', async () => {
    const service = new BookCatalogService();
    searchAndHydrateBooks.mockResolvedValue([
      {
        workId: 'OL1W',
        title: 'Dune',
        authors: ['Frank Herbert'],
      },
    ]);

    const results = await service.safeLookupMany(
      { title: 'Dune', author: 'Frank Herbert' },
      7,
      0,
      { offset: 14 },
    );

    expect(searchAndHydrateBooks).toHaveBeenCalledWith({
      title: 'Dune',
      author: 'Frank Herbert',
      limit: 7,
      offset: 14,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'Dune',
      provider: 'openlibrary',
      search: {
        query: {
          title: 'Dune',
          author: 'Frank Herbert',
          limit: 7,
          offset: 14,
        },
      },
    });
  });
});

describe('BookCatalogService.lookupFirstPass with catalog context', () => {
  const sharedRouter = { lookup: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USE_CATALOG_ROUTER = 'true';
    sharedRouter.lookup.mockReset();
    getCatalogRouter.mockReturnValue(sharedRouter);
  });

  afterEach(() => {
    delete process.env.USE_CATALOG_ROUTER;
  });

  it('passes shared catalogContext to router lookups', async () => {
    sharedRouter.lookup.mockImplementation(async (item) => ({
      title: item.title,
      primaryCreator: item.author || null,
      description: 'resolved',
    }));

    const service = new BookCatalogService({ useRouter: true });
    const catalogContext = { jobId: 'job-context-1' };
    const results = await service.lookupFirstPass(
      [{ title: 'A' }, { title: 'B' }],
      { catalogContext, concurrency: 2 }
    );

    expect(results).toHaveLength(2);
    expect(sharedRouter.lookup).toHaveBeenCalledTimes(2);
    expect(sharedRouter.lookup).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: 'A' }),
      'books',
      expect.objectContaining({ catalogContext })
    );
    expect(sharedRouter.lookup).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ title: 'B' }),
      'books',
      expect.objectContaining({ catalogContext })
    );
  });

  it('propagates CATALOG_PROVIDERS_UNAVAILABLE from router lookup', async () => {
    sharedRouter.lookup.mockImplementation(async () => {
      const err = new Error('providers down');
      err.code = 'CATALOG_PROVIDERS_UNAVAILABLE';
      throw err;
    });

    const service = new BookCatalogService({ useRouter: true });

    await expect(
      service.lookupFirstPass(
        [{ title: 'A' }, { title: 'B' }],
        { catalogContext: { jobId: 'job-context-2' }, concurrency: 2 }
      )
    ).rejects.toMatchObject({ code: 'CATALOG_PROVIDERS_UNAVAILABLE' });
  });
});
