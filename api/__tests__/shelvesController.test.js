const shelvesController = require('../controllers/shelvesController');
const { VisionPipelineService } = require('../services/visionPipeline');
const shelvesQueries = require('../database/queries/shelves');

jest.mock('../services/visionPipeline');
jest.mock('../database/queries/shelves');

describe('shelvesController', () => {
    let req, res;
    let mockPipelineInstance;

    beforeEach(() => {
        req = {
            user: { id: 1, isPremium: true },
            params: { shelfId: '10' },
            body: { imageBase64: 'data:image/jpeg;base64,aabbcc' }
        };
        res = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        };

        mockPipelineInstance = {
            processImage: jest.fn().mockResolvedValue({
                analysis: {},
                results: { added: 0, needsReview: 0 },
                addedItems: [],
                needsReview: []
            })
        };
        VisionPipelineService.mockImplementation(() => mockPipelineInstance);

        // Mock loadShelfForUser via the query it calls? 
        // Controller calls loadShelfForUser which calls shelvesQueries.getById
        shelvesQueries.getById.mockResolvedValue({ id: 10, type: 'book' });
        shelvesQueries.getItems.mockResolvedValue([]);
    });

    describe('processShelfVision', () => {
        it('should return 403 if user is not premium', async () => {
            req.user.isPremium = false;
            await shelvesController.processShelfVision(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requiresPremium: true }));
        });

        it('should return 400 if imageBase64 is missing', async () => {
            req.body.imageBase64 = null;
            await shelvesController.processShelfVision(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('should call vision pipeline and return structured results', async () => {
            await shelvesController.processShelfVision(req, res);

            expect(mockPipelineInstance.processImage).toHaveBeenCalledWith(
                'data:image/jpeg;base64,aabbcc',
                expect.objectContaining({ id: 10 }),
                1
            );
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                visionStatus: { status: 'completed', provider: 'google-vision-gemini-pipeline' }
            }));
        });

        it('should duplicate hydration of items in response', async () => {
            shelvesQueries.getItems.mockResolvedValue(['item1']);
            await shelvesController.processShelfVision(req, res);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ items: ['item1'] }));
        });
    });
});
