jest.mock('../openLibrary', () => ({
  lookupWorkBookMetadata: jest.fn(),
  searchAndHydrateBooks: jest.fn(),
  lookupWorkByISBN: jest.fn(),
}));

jest.mock('../../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { BookCatalogService } = require('./BookCatalogService');
const { searchAndHydrateBooks } = require('../openLibrary');

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
