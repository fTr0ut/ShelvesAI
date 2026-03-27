const {
  _buildFeedItemsFromPayloads: buildFeedItemsFromPayloads,
  _mapFeedDetailItemRow: mapFeedDetailItemRow,
  _mergeCheckinRatingPairs: mergeCheckinRatingPairs,
  _mergeReviewedRatingPairs: mergeReviewedRatingPairs,
} = require('../controllers/feedController');

function makeCheckin({ id, createdAt, collectableId = 101, ownerId = 'u1' }) {
  return {
    id,
    eventType: 'checkin.activity',
    createdAt,
    owner: { id: ownerId },
    collectable: { id: collectableId, title: 'Shared Title' },
  };
}

function makeRating({ id, createdAt, ownerId = 'u1', items }) {
  return {
    id,
    eventType: 'item.rated',
    createdAt,
    owner: { id: ownerId },
    items,
    eventItemCount: items.length,
  };
}

function makeReviewed({ id, createdAt, ownerId = 'u1', items }) {
  return {
    id,
    eventType: 'reviewed',
    createdAt,
    owner: { id: ownerId },
    items,
    eventItemCount: items.length,
  };
}

describe('mergeCheckinRatingPairs', () => {
  it('consumes one rating item at most once (most recent check-in wins)', () => {
    const entries = [
      makeCheckin({ id: 'checkin-new', createdAt: '2026-03-25T12:05:00.000Z' }),
      makeCheckin({ id: 'checkin-old', createdAt: '2026-03-25T12:00:00.000Z' }),
      makeRating({
        id: 'rating-1',
        createdAt: '2026-03-25T12:03:00.000Z',
        items: [{ collectableId: 101, rating: 4.5, collectable: { id: 101, title: 'Shared Title' } }],
      }),
    ];

    const merged = mergeCheckinRatingPairs(entries, { windowMinutes: 30 });
    const byId = new Map(merged.map((entry) => [entry.id, entry]));

    expect(byId.get('checkin-new').eventType).toBe('checkin.rated');
    expect(byId.get('checkin-new').rating).toBe(4.5);
    expect(byId.get('checkin-old').eventType).toBe('checkin.activity');
    expect(merged.some((entry) => entry.id === 'rating-1')).toBe(false);
  });
});

describe('buildFeedItemsFromPayloads', () => {
  it('maps creator/year fields for added collectable payloads', () => {
    const items = buildFeedItemsFromPayloads([
      {
        itemId: 77,
        collectableId: 101,
        title: 'The Item',
        creator: 'The Creator',
        year: 1999,
        coverMediaPath: 'covers/101.jpg',
      },
    ], 'item.added', 5);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      itemId: 77,
      collectableId: 101,
      title: 'The Item',
      creator: 'The Creator',
      year: 1999,
      collectable: expect.objectContaining({
        id: 101,
        title: 'The Item',
        primaryCreator: 'The Creator',
        year: 1999,
        coverMediaPath: 'covers/101.jpg',
      }),
    });
  });

  it('maps creator/year fields for added manual payloads', () => {
    const items = buildFeedItemsFromPayloads([
      {
        itemId: 88,
        manualId: 202,
        name: 'Manual Item',
        creator: 'Manual Creator',
        year: 2005,
        coverMediaPath: 'manuals/202.jpg',
      },
    ], 'item.manual_added', 5);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      itemId: 88,
      title: 'Manual Item',
      creator: 'Manual Creator',
      year: 2005,
      manual: expect.objectContaining({
        id: 202,
        name: 'Manual Item',
        author: 'Manual Creator',
        year: 2005,
        coverMediaPath: 'manuals/202.jpg',
      }),
    });
  });
});

describe('mapFeedDetailItemRow', () => {
  it('hydrates collectable year for feed-detail items', () => {
    const item = mapFeedDetailItemRow({
      id: 501,
      collectable_id: 111,
      manual_id: null,
      collectable_title: 'Detail Item',
      collectable_primary_creator: 'Detail Creator',
      collectable_cover_url: 'https://img.example/detail.jpg',
      collectable_kind: 'books',
      collectable_year: 2014,
      manual_name: null,
      manual_author: null,
      manual_year: null,
      manual_cover_media_path: null,
    });

    expect(item).toMatchObject({
      itemId: 501,
      title: 'Detail Item',
      creator: 'Detail Creator',
      year: 2014,
      collectable: expect.objectContaining({
        id: 111,
        title: 'Detail Item',
        primaryCreator: 'Detail Creator',
        year: 2014,
      }),
    });
  });
});

describe('mergeReviewedRatingPairs', () => {
  it('merges reviewed with a later rating for the same item and removes duplicate rating entry', () => {
    const entries = [
      makeReviewed({
        id: 'reviewed-1',
        createdAt: '2026-03-25T12:00:00.000Z',
        items: [{ id: 9001, collectableId: 101, notes: 'Great read', rating: null, collectable: { id: 101, title: 'Shared Title' } }],
      }),
      makeRating({
        id: 'rating-1',
        createdAt: '2026-03-25T12:10:00.000Z',
        items: [{ id: 9001, collectableId: 101, rating: 4.5, collectable: { id: 101, title: 'Shared Title' } }],
      }),
    ];

    const merged = mergeReviewedRatingPairs(entries, { windowMinutes: 120 });

    expect(merged).toHaveLength(1);
    expect(merged[0].eventType).toBe('reviewed');
    expect(merged[0].items[0].rating).toBe(4.5);
    expect(merged[0].createdAt).toBe('2026-03-25T12:10:00.000Z');
  });

  it('merges when rating happened before the review within window', () => {
    const entries = [
      makeReviewed({
        id: 'reviewed-1',
        createdAt: '2026-03-25T12:10:00.000Z',
        items: [{ id: 9001, collectableId: 101, notes: 'Great read', rating: null, collectable: { id: 101, title: 'Shared Title' } }],
      }),
      makeRating({
        id: 'rating-1',
        createdAt: '2026-03-25T12:00:00.000Z',
        items: [{ id: 9001, collectableId: 101, rating: 4.5, collectable: { id: 101, title: 'Shared Title' } }],
      }),
    ];

    const merged = mergeReviewedRatingPairs(entries, { windowMinutes: 120 });

    expect(merged).toHaveLength(1);
    expect(merged.some((entry) => entry.eventType === 'item.rated')).toBe(false);
    const reviewed = merged.find((entry) => entry.eventType === 'reviewed');
    expect(reviewed.items[0].rating).toBe(4.5);
  });

  it('does not merge when itemId differs even if collectable identity matches', () => {
    const entries = [
      makeReviewed({
        id: 'reviewed-1',
        createdAt: '2026-03-25T12:00:00.000Z',
        items: [{ id: 9001, collectableId: 101, notes: 'Great read', rating: null, collectable: { id: 101, title: 'Shared Title' } }],
      }),
      makeRating({
        id: 'rating-1',
        createdAt: '2026-03-25T12:10:00.000Z',
        items: [{ id: 9002, collectableId: 101, rating: 4.5, collectable: { id: 101, title: 'Shared Title' } }],
      }),
    ];

    const merged = mergeReviewedRatingPairs(entries, { windowMinutes: 120 });

    expect(merged).toHaveLength(2);
    const reviewed = merged.find((entry) => entry.eventType === 'reviewed');
    expect(reviewed.items[0].rating).toBeNull();
  });

  it('omits standalone rating when rating happens before review within window', () => {
    const entries = [
      makeRating({
        id: 'rating-1',
        createdAt: '2026-03-25T12:00:00.000Z',
        items: [{ id: 9001, collectableId: 101, rating: 4.0, collectable: { id: 101, title: 'Shared Title' } }],
      }),
      makeReviewed({
        id: 'reviewed-1',
        createdAt: '2026-03-25T12:10:00.000Z',
        items: [{ id: 9001, collectableId: 101, notes: 'Great read', rating: 4.0, collectable: { id: 101, title: 'Shared Title' } }],
      }),
    ];

    const merged = mergeReviewedRatingPairs(entries, { windowMinutes: 120 });

    expect(merged).toHaveLength(1);
    expect(merged[0].eventType).toBe('reviewed');
    expect(merged[0].items[0].rating).toBe(4.0);
  });

  it('merges when rating payload lacks itemId but collectable identity matches (legacy rating events)', () => {
    const entries = [
      makeReviewed({
        id: 'reviewed-1',
        createdAt: '2026-03-25T12:00:00.000Z',
        items: [{ id: 9001, collectableId: 101, notes: 'Great read', rating: null, collectable: { id: 101, title: 'Shared Title' } }],
      }),
      makeRating({
        id: 'rating-1',
        createdAt: '2026-03-25T12:10:00.000Z',
        items: [{ collectableId: 101, rating: 4.5, collectable: { id: 101, title: 'Shared Title' } }],
      }),
    ];

    const merged = mergeReviewedRatingPairs(entries, { windowMinutes: 120 });

    expect(merged).toHaveLength(1);
    expect(merged[0].eventType).toBe('reviewed');
    expect(merged[0].items[0].rating).toBe(4.5);
  });
});
