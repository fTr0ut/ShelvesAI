jest.mock('../database/pg', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { query } = require('../database/pg');
const shelvesQueries = require('../database/queries/shelves');

describe('shelves owned platform queries', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('replaces owned platforms for a collection item', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 55 }] })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ platform_name: 'PS5' }, { platform_name: 'PlayStation 5' }] });

    const result = await shelvesQueries.replaceOwnedPlatformsForCollectionItem({
      collectionItemId: 55,
      userId: 'user-1',
      shelfId: 10,
      platforms: ['PlayStation 5', 'PS5', 'PlayStation 5'],
    });

    expect(result).toEqual(['PS5', 'PlayStation 5']);
    expect(query.mock.calls[0][0]).toContain('FROM user_collections');
    expect(query.mock.calls[1][0]).toContain('DELETE FROM user_collection_platforms');
    expect(query.mock.calls[2][0]).toContain('INSERT INTO user_collection_platforms');
    expect(query.mock.calls[2][1]).toEqual([55, ['PlayStation 5', 'PS5']]);
  });

  it('ensures owned platforms are inserted idempotently', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ platform_name: 'Nintendo Switch' }] });

    const result = await shelvesQueries.ensureOwnedPlatformsForCollectionItem({
      collectionItemId: 90,
      platforms: ['Nintendo Switch', 'nintendo switch'],
    });

    expect(query.mock.calls[0][0]).toContain('ON CONFLICT DO NOTHING');
    expect(query.mock.calls[0][1]).toEqual([90, ['Nintendo Switch']]);
    expect(result).toEqual(['Nintendo Switch']);
  });

  it('searchUserCollection SQL includes owned platform text matching', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await shelvesQueries.searchUserCollection('user-2', 'playstation', { limit: 10, offset: 0 });

    const sql = query.mock.calls[0][0];
    expect(sql).toContain('FROM user_collection_platforms ucp');
    expect(sql).toContain("ucp.platform_name ILIKE '%' || $1 || '%'");
  });
});
