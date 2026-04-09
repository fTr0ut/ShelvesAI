const { query } = require('../database/pg');
const { getNewsRecommendationsForUser } = require('../services/discovery/newsRecommendations');

describe('newsRecommendations.getNewsRecommendationsForUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue({ rows: [] });
  });

  it('aggregates multiple matching 4k formats into one scalar count', async () => {
    await getNewsRecommendationsForUser('user-1');

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];

    expect(sql).toMatch(/SELECT SUM\(count\)::int FROM format_counts WHERE format = ANY\(\$4\)/i);
    expect(params[3]).toEqual(['4k', '4k uhd', 'uhd', '4k uhd blu-ray']);
  });

  it('groups rows by category and item type after query execution', async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: 11,
          category: 'movies',
          item_type: 'upcoming_4k',
          title: 'Movie A',
          description: 'First item',
          cover_image_url: 'https://example.com/a.jpg',
          release_date: '2026-04-10T00:00:00.000Z',
          physical_release_date: null,
          creators: ['Director A'],
          genres: ['Sci-Fi'],
          external_id: 'ext-a',
          source_api: 'tmdb',
          source_url: 'https://example.com/a',
          payload: { popularity: 10 },
          relevance_score: 6,
          reasons: ['category', 'format:4k'],
          collectable_id: 101,
          collectable_kind: 'movie',
          collectable_primary_creator: 'Director A',
          group_rank: 1,
          max_score: 6,
          latest_date: '2026-04-10T00:00:00.000Z',
          profile_category_count: 2,
        },
        {
          id: 12,
          category: 'movies',
          item_type: 'upcoming_4k',
          title: 'Movie B',
          description: 'Second item',
          cover_image_url: 'https://example.com/b.jpg',
          release_date: '2026-04-12T00:00:00.000Z',
          physical_release_date: null,
          creators: ['Director B'],
          genres: ['Action'],
          external_id: 'ext-b',
          source_api: 'tmdb',
          source_url: 'https://example.com/b',
          payload: { popularity: 9 },
          relevance_score: 5,
          reasons: ['category'],
          collectable_id: 102,
          collectable_kind: 'movie',
          collectable_primary_creator: 'Director B',
          group_rank: 1,
          max_score: 6,
          latest_date: '2026-04-12T00:00:00.000Z',
          profile_category_count: 2,
        },
        {
          id: 21,
          category: 'books',
          item_type: 'bestseller',
          title: 'Book A',
          description: 'Third item',
          cover_image_url: 'https://example.com/c.jpg',
          release_date: '2026-04-11T00:00:00.000Z',
          physical_release_date: null,
          creators: ['Author A'],
          genres: ['Fantasy'],
          external_id: 'ext-c',
          source_api: 'nyt',
          source_url: 'https://example.com/c',
          payload: { popularity: 8 },
          relevance_score: 4,
          reasons: ['category'],
          collectable_id: 201,
          collectable_kind: 'book',
          collectable_primary_creator: 'Author A',
          group_rank: 2,
          max_score: 4,
          latest_date: '2026-04-11T00:00:00.000Z',
          profile_category_count: 2,
        },
      ],
    });

    const groups = await getNewsRecommendationsForUser('user-1', {
      groupLimit: 3,
      itemsPerGroup: 3,
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      key: 'movies:upcoming_4k',
      category: 'movies',
      itemType: 'upcoming_4k',
      groupRank: 1,
      maxScore: 6,
    });
    expect(groups[0].items.map((item) => item.id)).toEqual([11, 12]);
    expect(groups[1]).toMatchObject({
      key: 'books:bestseller',
      category: 'books',
      itemType: 'bestseller',
      groupRank: 2,
      maxScore: 4,
    });
    expect(groups[1].items.map((item) => item.id)).toEqual([21]);
  });
});
