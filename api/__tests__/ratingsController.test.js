const ratingsController = require('../controllers/ratingsController');
const ratingsQueries = require('../database/queries/ratings');
const collectablesQueries = require('../database/queries/collectables');
const shelvesQueries = require('../database/queries/shelves');
const feedQueries = require('../database/queries/feed');

jest.mock('../database/queries/ratings');
jest.mock('../database/queries/collectables');
jest.mock('../database/queries/shelves');
jest.mock('../database/queries/feed', () => ({
  logEvent: jest.fn().mockResolvedValue(null),
}));

function createReq(overrides = {}) {
  return {
    params: { itemId: '101' },
    body: { rating: 4 },
    query: {},
    user: { id: 'user-1' },
    ...overrides,
  };
}

function createRes() {
  const res = {
    json: jest.fn(),
    status: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('ratingsController.setRating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not log item.rated when rating is unchanged', async () => {
    const req = createReq();
    const res = createRes();

    ratingsQueries.setRating.mockResolvedValue({
      rating: { id: 1, rating: 4 },
      changed: false,
      previousRating: 4,
      currentRating: 4,
    });

    await ratingsController.setRating(req, res);

    expect(feedQueries.logEvent).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ rating: 4 });
  });

  it('logs item.rated when rating changes via /api/ratings endpoint', async () => {
    const req = createReq();
    const res = createRes();

    ratingsQueries.setRating.mockResolvedValue({
      rating: { id: 1, rating: 4.5 },
      changed: true,
      previousRating: 4,
      currentRating: 4.5,
    });
    collectablesQueries.findById.mockResolvedValue({
      id: 101,
      title: 'The Item',
      primaryCreator: 'The Creator',
      kind: 'movie',
    });

    await ratingsController.setRating(req, res);

    expect(feedQueries.logEvent).toHaveBeenCalledTimes(1);
    expect(feedQueries.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        shelfId: null,
        eventType: 'item.rated',
        payload: expect.objectContaining({
          collectableId: 101,
          rating: 4.5,
        }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ rating: 4.5 });
  });
});
