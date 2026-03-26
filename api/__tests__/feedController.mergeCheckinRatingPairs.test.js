const {
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
