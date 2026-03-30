jest.mock('../database/pg', () => ({
  query: jest.fn(),
}));

const { query } = require('../database/pg');
const visionItemRegionsQueries = require('../database/queries/visionItemRegions');

describe('visionItemRegionsQueries.upsertRegionsForScan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes existing rows first when replaceExisting is true', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            user_id: 'user-1',
            shelf_id: 20,
            scan_photo_id: 30,
            extraction_index: 0,
            box_2d: [100, 200, 500, 800],
          },
        ],
      });

    const result = await visionItemRegionsQueries.upsertRegionsForScan({
      userId: 'user-1',
      shelfId: 20,
      scanPhotoId: 30,
      replaceExisting: true,
      regions: [
        {
          extractionIndex: 0,
          title: 'Test Item',
          primaryCreator: 'Test Creator',
          box2d: [100, 200, 500, 800],
          confidence: 0.95,
        },
      ],
    });

    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WITH doomed_crops AS'),
      ['user-1', 20, 30],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM vision_item_regions'),
      ['user-1', 20, 30],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO vision_item_regions'),
      expect.any(Array),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 10,
      extractionIndex: 0,
      box2d: [100, 200, 500, 800],
    });
  });

  it('still clears stale rows when replaceExisting is true and regions is empty', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 3 });

    const result = await visionItemRegionsQueries.upsertRegionsForScan({
      userId: 'user-1',
      shelfId: 20,
      scanPhotoId: 30,
      replaceExisting: true,
      regions: [],
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WITH doomed_crops AS'),
      ['user-1', 20, 30],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM vision_item_regions'),
      ['user-1', 20, 30],
    );
    expect(result).toEqual([]);
  });

  it('continues replaceExisting delete when crop/owner-photo schema pieces are unavailable', async () => {
    const missingRelationErr = new Error('relation "vision_item_crops" does not exist');
    missingRelationErr.code = '42P01';
    query
      .mockRejectedValueOnce(missingRelationErr)
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 11,
            user_id: 'user-1',
            shelf_id: 20,
            scan_photo_id: 30,
            extraction_index: 0,
            box_2d: [100, 200, 500, 800],
          },
        ],
      });

    const result = await visionItemRegionsQueries.upsertRegionsForScan({
      userId: 'user-1',
      shelfId: 20,
      scanPhotoId: 30,
      replaceExisting: true,
      regions: [
        {
          extractionIndex: 0,
          title: 'Test Item',
          primaryCreator: 'Test Creator',
          box2d: [100, 200, 500, 800],
          confidence: 0.95,
        },
      ],
    });

    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM vision_item_regions'),
      ['user-1', 20, 30],
    );
    expect(result).toHaveLength(1);
  });
});

describe('visionItemRegionsQueries.linkCollectionItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('links a region to an exact user_collections item by scan and extraction index', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 44,
          scan_photo_id: 30,
          extraction_index: 2,
          collection_item_id: 901,
        },
      ],
    });

    const result = await visionItemRegionsQueries.linkCollectionItem({
      scanPhotoId: 30,
      extractionIndex: 2,
      collectionItemId: 901,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET collection_item_id = $1'),
      [901, 30, 2],
    );
    expect(result).toMatchObject({
      id: 44,
      extractionIndex: 2,
      collectionItemId: 901,
    });
  });
});

describe('visionItemRegionsQueries.clearCollectionItemLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears collection_item_id for one scan/extraction row', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 44,
          scan_photo_id: 30,
          extraction_index: 2,
          collection_item_id: null,
        },
      ],
    });

    const result = await visionItemRegionsQueries.clearCollectionItemLink({
      scanPhotoId: 30,
      extractionIndex: 2,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET collection_item_id = NULL'),
      [30, 2],
    );
    expect(result).toMatchObject({
      id: 44,
      extractionIndex: 2,
      collectionItemId: null,
    });
  });
});
