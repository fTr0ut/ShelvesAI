jest.mock('../database/queries/needsReview', () => ({
  getById: jest.fn(),
  dismiss: jest.fn(),
  dismissAllForUser: jest.fn(),
  listAllPendingForUser: jest.fn(),
  countPendingForUser: jest.fn(),
}));

jest.mock('../database/queries/shelves', () => ({
  getById: jest.fn(),
}));

jest.mock('../controllers/shelvesController', () => ({
  completeReviewItemInternal: jest.fn(),
}));

const needsReviewQueries = require('../database/queries/needsReview');
const shelvesQueries = require('../database/queries/shelves');
const { completeReviewItemInternal } = require('../controllers/shelvesController');
const router = require('../routes/unmatched');

function findRouteHandlers(method, path) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route?.methods?.[method]);
  return layer?.route?.stack?.map((entry) => entry.handle) || [];
}

describe('unmatched routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates PUT /:id to the shared review completion helper', async () => {
    const handlers = findRouteHandlers('put', '/:id');
    const validate = handlers[0];
    const handler = handlers[1];
    const req = {
      user: { id: 1 },
      params: { id: '55' },
      body: {},
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    const reviewItem = {
      id: 55,
      shelfId: 10,
      rawData: {
        title: 'Mystery Bottle',
        reviewContext: {
          scanPhotoId: 77,
          extractionIndex: 4,
          shelfType: 'other',
          reason: 'missing_fields',
        },
      },
    };
    const shelf = { id: 10, type: 'other' };
    needsReviewQueries.getById.mockResolvedValue(reviewItem);
    shelvesQueries.getById.mockResolvedValue(shelf);
    completeReviewItemInternal.mockResolvedValue({
      kind: 'manual',
      matchSource: 'manual',
      item: { id: 1201, position: null },
      manual: { id: 1301, name: 'Mystery Bottle', author: null },
    });

    const next = jest.fn();
    validate(req, res, next);
    expect(next).toHaveBeenCalled();

    await handler(req, res);

    expect(completeReviewItemInternal).toHaveBeenCalledWith({
      userId: 1,
      shelf,
      reviewItem,
      body: {},
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      matchSource: 'manual',
      item: {
        id: 1201,
        manual: { id: 1301, name: 'Mystery Bottle', author: null },
        position: null,
      },
    });
  });
});
