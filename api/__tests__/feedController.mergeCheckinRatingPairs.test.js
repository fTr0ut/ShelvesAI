const { _mergeCheckinRatingPairs: mergeCheckinRatingPairs } = require('../controllers/feedController');

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
