const shelvesController = require('../controllers/shelvesController');
const needsReviewQueries = require('../database/queries/needsReview');
const collectablesQueries = require('../database/queries/collectables');
const shelvesQueries = require('../database/queries/shelves');

jest.mock('../database/queries/needsReview');
jest.mock('../database/queries/collectables');
jest.mock('../database/queries/shelves');
jest.mock('../services/collectables/fingerprint', () => ({
    makeLightweightFingerprint: jest.fn(() => 'lwf'),
    makeCollectableFingerprint: jest.fn(() => 'fp')
}));

describe('Needs Review Controller', () => {
    let req, res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            user: { id: 1 },
            params: { shelfId: '10', id: '5' },
            body: {}
        };
        res = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        };

        shelvesQueries.getById.mockResolvedValue({ id: 10, type: 'book' });
    });

    describe('listReviewItems', () => {
        it('should list pending items', async () => {
            needsReviewQueries.listPending.mockResolvedValue(['item1']);
            await shelvesController.listReviewItems(req, res);
            expect(needsReviewQueries.listPending).toHaveBeenCalledWith(1, 10);
            expect(res.json).toHaveBeenCalledWith({ items: ['item1'] });
        });
    });

    describe('completeReviewItem', () => {
        beforeEach(() => {
            needsReviewQueries.getById.mockResolvedValue({
                id: 5,
                rawData: { title: 'Raw Title', primaryCreator: 'Raw Author' }
            });
        });

        it('should create new collectable if no match found', async () => {
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
            collectablesQueries.fuzzyMatch.mockResolvedValue(null);
            collectablesQueries.upsert.mockResolvedValue({ id: 100, title: 'Raw Title' });
            shelvesQueries.addCollectable.mockResolvedValue({ id: 999 });

            await shelvesController.completeReviewItem(req, res);

            expect(collectablesQueries.upsert).toHaveBeenCalled();
            expect(shelvesQueries.addCollectable).toHaveBeenCalledWith(expect.objectContaining({ collectableId: 100 }));
            expect(needsReviewQueries.markCompleted).toHaveBeenCalledWith(5, 1);
        });

        it('should link existing collectable if match found', async () => {
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue({ id: 200, title: 'Existing' });
            shelvesQueries.addCollectable.mockResolvedValue({ id: 999 });

            await shelvesController.completeReviewItem(req, res);

            expect(collectablesQueries.upsert).not.toHaveBeenCalled();
            expect(shelvesQueries.addCollectable).toHaveBeenCalledWith(expect.objectContaining({ collectableId: 200 }));
            expect(needsReviewQueries.markCompleted).toHaveBeenCalledWith(5, 1);
        });

        it('should merge user edits', async () => {
            req.body = { title: 'Edited Title' };
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
            collectablesQueries.fuzzyMatch.mockResolvedValue(null);
            collectablesQueries.upsert.mockResolvedValue({ id: 101 });
            shelvesQueries.addCollectable.mockResolvedValue({ id: 999 });

            await shelvesController.completeReviewItem(req, res);

            expect(collectablesQueries.upsert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Edited Title' }));
        });
    });

    describe('dismissReviewItem', () => {
        it('should dismiss item', async () => {
            needsReviewQueries.dismiss.mockResolvedValue({ id: 5, status: 'dismissed' });
            await shelvesController.dismissReviewItem(req, res);
            expect(needsReviewQueries.dismiss).toHaveBeenCalledWith('5', 1);
            expect(res.json).toHaveBeenCalledWith({ dismissed: true, id: '5' });
        });
    });
});
