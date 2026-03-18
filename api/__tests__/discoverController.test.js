/**
 * Tests for discoverController — focused on the category=all & item_type=all
 * pagination fix (BUG-15): offset must be forwarded to the CTE query path.
 */

const { query } = require('../database/pg');
const { getDiscover } = require('../controllers/discoverController');

// database/pg is mocked globally by __tests__/setup.js
// We just need to control what query() returns per test.

function makeReq({ category = 'all', item_type = 'all', limit, offset, userId } = {}) {
  return {
    user: userId ? { id: userId } : undefined,
    query: {
      category,
      item_type,
      ...(limit !== undefined && { limit: String(limit) }),
      ...(offset !== undefined && { offset: String(offset) }),
    },
  };
}

function makeRes() {
  const res = {
    json: jest.fn(),
    status: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('discoverController.getDiscover', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: query returns empty rows
    query.mockResolvedValue({ rows: [] });
  });

  describe('category=all & item_type=all path', () => {
    it('passes offset=0 to the SQL query when no offset is supplied', async () => {
      const req = makeReq({ category: 'all', item_type: 'all' });
      const res = makeRes();

      await getDiscover(req, res);

      // The all-path calls query() once (no userId means no interests query)
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];

      // SQL must contain LIMIT and OFFSET
      expect(sql).toMatch(/LIMIT\s+\$\d+/i);
      expect(sql).toMatch(/OFFSET\s+\$\d+/i);

      // The last two params should be safeLimit (50) and safeOffset (0)
      const last2 = params.slice(-2);
      expect(last2).toEqual([50, 0]);
    });

    it('passes the requested offset to the SQL query', async () => {
      const req = makeReq({ category: 'all', item_type: 'all', limit: 20, offset: 40 });
      const res = makeRes();

      await getDiscover(req, res);

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];

      expect(sql).toMatch(/LIMIT\s+\$\d+/i);
      expect(sql).toMatch(/OFFSET\s+\$\d+/i);

      const last2 = params.slice(-2);
      expect(last2).toEqual([20, 40]);
    });

    it('returns pagination object with the requested offset', async () => {
      query.mockResolvedValue({ rows: [] });
      const req = makeReq({ category: 'all', item_type: 'all', limit: 10, offset: 30 });
      const res = makeRes();

      await getDiscover(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            pagination: expect.objectContaining({
              limit: 10,
              offset: 30,
            }),
          }),
        })
      );
    });

    it('hasMore is true when result count equals limit', async () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        category: 'movies',
        item_type: 'trending',
        title: `Item ${i + 1}`,
        description: null,
        cover_image_url: null,
        release_date: null,
        physical_release_date: null,
        creators: [],
        genres: [],
        external_id: null,
        source_api: null,
        source_url: null,
        payload: {},
        relevance_score: 0,
      }));
      query.mockResolvedValue({ rows });

      const req = makeReq({ category: 'all', item_type: 'all', limit: 10, offset: 0 });
      const res = makeRes();

      await getDiscover(req, res);

      const { pagination } = res.json.mock.calls[0][0].data;
      expect(pagination.hasMore).toBe(true);
      expect(pagination.count).toBe(10);
    });

    it('hasMore is false when result count is less than limit', async () => {
      query.mockResolvedValue({ rows: [] });

      const req = makeReq({ category: 'all', item_type: 'all', limit: 10, offset: 0 });
      const res = makeRes();

      await getDiscover(req, res);

      const { pagination } = res.json.mock.calls[0][0].data;
      expect(pagination.hasMore).toBe(false);
      expect(pagination.count).toBe(0);
    });

    it('preserves the ROW_NUMBER PARTITION BY in the CTE', async () => {
      const req = makeReq({ category: 'all', item_type: 'all' });
      const res = makeRes();

      await getDiscover(req, res);

      const [sql] = query.mock.calls[0];
      expect(sql).toMatch(/ROW_NUMBER\(\)\s+OVER\s*\(/i);
      expect(sql).toMatch(/PARTITION\s+BY\s+category,\s*item_type/i);
    });
  });

  describe('non-all paths (regression guard)', () => {
    it('specific category path still uses LIMIT and OFFSET', async () => {
      const req = makeReq({ category: 'movies', item_type: 'all', limit: 10, offset: 20 });
      const res = makeRes();

      await getDiscover(req, res);

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/LIMIT\s+\$\d+/i);
      expect(sql).toMatch(/OFFSET\s+\$\d+/i);
      const last2 = params.slice(-2);
      expect(last2).toEqual([10, 20]);
    });

    it('specific item_type path still uses LIMIT and OFFSET', async () => {
      const req = makeReq({ category: 'all', item_type: 'trending', limit: 5, offset: 15 });
      const res = makeRes();

      await getDiscover(req, res);

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/LIMIT\s+\$\d+/i);
      expect(sql).toMatch(/OFFSET\s+\$\d+/i);
      const last2 = params.slice(-2);
      expect(last2).toEqual([5, 15]);
    });
  });

  describe('with authenticated user', () => {
    it('fires two queries (interests + discover) and still passes offset', async () => {
      // First call: user interests query → empty rows
      // Second call: discover query → empty rows
      query
        .mockResolvedValueOnce({ rows: [] })   // interests
        .mockResolvedValueOnce({ rows: [] });  // discover

      const req = makeReq({ category: 'all', item_type: 'all', limit: 10, offset: 50, userId: 42 });
      const res = makeRes();

      await getDiscover(req, res);

      expect(query).toHaveBeenCalledTimes(2);
      const [sql, params] = query.mock.calls[1]; // second call is the discover query
      const last2 = params.slice(-2);
      expect(last2).toEqual([10, 50]);
    });
  });
});
