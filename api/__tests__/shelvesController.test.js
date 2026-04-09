const sharp = require('sharp');
const shelvesController = require('../controllers/shelvesController');
const { VisionPipelineService } = require('../services/visionPipeline');
const shelvesQueries = require('../database/queries/shelves');
const visionResultCacheQueries = require('../database/queries/visionResultCache');
const visionScanPhotosQueries = require('../database/queries/visionScanPhotos');
const visionItemRegionsQueries = require('../database/queries/visionItemRegions');
const visionItemCropsQueries = require('../database/queries/visionItemCrops');
const workflowQueueJobsQueries = require('../database/queries/workflowQueueJobs');
const userCollectionPhotosQueries = require('../database/queries/userCollectionPhotos');
const shelfPhotosQueries = require('../database/queries/shelfPhotos');
const manualMediaQueries = require('../database/queries/manualMedia');
const needsReviewQueries = require('../database/queries/needsReview');
const collectablesQueries = require('../database/queries/collectables');
const feedQueries = require('../database/queries/feed');
const ratingsQueries = require('../database/queries/ratings');
const itemReplacementTracesQueries = require('../database/queries/itemReplacementTraces');
const { query } = require('../database/pg');
const { getWorkflowQueueService } = require('../services/workflowQueueService');
const { getWorkflowQueueSettings } = require('../services/workflow/workflowSettings');
const processingStatus = require('../services/processingStatus');

jest.mock('../services/visionPipeline');
jest.mock('../database/queries/shelves');
jest.mock('../database/queries/visionResultCache', () => ({
    getValid: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(null),
    deleteByHash: jest.fn().mockResolvedValue(0),
}));
jest.mock('../database/queries/visionScanPhotos', () => ({
    upsertFromBuffer: jest.fn().mockResolvedValue({ id: 77 }),
    getByIdForUser: jest.fn().mockResolvedValue(null),
    loadImageBuffer: jest.fn(),
    deleteByHash: jest.fn().mockResolvedValue({ deleted: false, deletedRows: 0 }),
}));
jest.mock('../database/queries/visionItemRegions', () => ({
    countForScan: jest.fn().mockResolvedValue(0),
    listForScan: jest.fn().mockResolvedValue([]),
    getByIdForScan: jest.fn().mockResolvedValue(null),
    getByExtractionIndexForScan: jest.fn().mockResolvedValue(null),
    linkCollectable: jest.fn().mockResolvedValue(null),
    linkManual: jest.fn().mockResolvedValue(null),
    linkCollectionItem: jest.fn().mockResolvedValue(null),
    hasCollectionItemLinkForReference: jest.fn().mockResolvedValue(false),
}));
jest.mock('../database/queries/visionItemCrops', () => ({
    getByRegionIdForUser: jest.fn().mockResolvedValue(null),
    listForScan: jest.fn().mockResolvedValue([]),
    upsertFromBuffer: jest.fn().mockResolvedValue(null),
    loadImageBuffer: jest.fn(),
}));
jest.mock('../database/queries/workflowQueueJobs', () => ({
    enqueueJob: jest.fn().mockResolvedValue(null),
    findActiveByDedupeKey: jest.fn().mockResolvedValue(null),
    getByJobIdForUser: jest.fn().mockResolvedValue(null),
    getQueuePosition: jest.fn().mockResolvedValue(null),
    countQueuedForUser: jest.fn().mockResolvedValue(0),
    countQueued: jest.fn().mockResolvedValue(0),
    countRunning: jest.fn().mockResolvedValue(0),
    requestAbort: jest.fn().mockResolvedValue(null),
    updateNotifyOnComplete: jest.fn().mockResolvedValue(null),
    updateNotifyInAppOnComplete: jest.fn().mockResolvedValue(null),
    setInAppOnlyCompletionNotice: jest.fn().mockResolvedValue(null),
    isAbortRequested: jest.fn().mockResolvedValue(false),
}));
jest.mock('../services/workflowQueueService', () => ({
    getWorkflowQueueService: jest.fn(() => ({
        registerHandler: jest.fn(),
        tick: jest.fn().mockResolvedValue(undefined),
    })),
}));
jest.mock('../services/workflow/workflowSettings', () => ({
    getWorkflowQueueSettings: jest.fn().mockResolvedValue({
        workflowQueueMaxRunning: 2,
        workflowQueueMaxRunningPerUser: 1,
        workflowQueueMaxQueuedPerUser: 4,
        workflowQueueLongThresholdPosition: 3,
        workflowQueueNotifyMinWaitMs: 20000,
        workflowQueueRetryMaxAttempts: 1,
        workflowQueueTerminalRetentionMs: 24 * 60 * 60 * 1000,
    }),
}));
jest.mock('../database/queries/userCollectionPhotos', () => ({
    getByCollectionItem: jest.fn().mockResolvedValue(null),
    loadOwnerPhotoThumbnailBuffer: jest.fn(),
    upsertOwnerPhotoThumbnailForItem: jest.fn(),
    attachVisionCropToItem: jest.fn().mockResolvedValue(null),
}));
jest.mock('../database/queries/shelfPhotos', () => ({
    getByShelfId: jest.fn().mockResolvedValue(null),
    uploadPhotoForShelf: jest.fn().mockResolvedValue(null),
    clearPhotoForShelf: jest.fn().mockResolvedValue(null),
    loadPhotoBuffer: jest.fn(),
}));
jest.mock('../database/queries/manualMedia', () => ({
    uploadFromBuffer: jest.fn().mockResolvedValue(null),
}));
jest.mock('../database/queries/feed', () => ({
    logEvent: jest.fn().mockResolvedValue(null),
    upsertReviewedEvent: jest.fn().mockResolvedValue(null),
}));
jest.mock('../database/queries/itemReplacementTraces', () => ({
    createIntent: jest.fn().mockResolvedValue(null),
    getByIdForUser: jest.fn().mockResolvedValue(null),
    markCompleted: jest.fn().mockResolvedValue(null),
    markFailed: jest.fn().mockResolvedValue(null),
}));
jest.mock('../database/queries/needsReview');
jest.mock('../database/queries/collectables');
jest.mock('../database/queries/ratings', () => ({
    getRating: jest.fn().mockResolvedValue({ rating: null }),
}));
jest.mock('../services/processingStatus', () => ({
    generateJobId: jest.fn(() => 'test-job-id'),
    createJob: jest.fn(),
    setJob: jest.fn(),
    updateJob: jest.fn(),
    completeJob: jest.fn(),
    failJob: jest.fn(),
    isAborted: jest.fn(() => false),
    getJob: jest.fn(),
    abortJob: jest.fn(),
}));
jest.mock('../database/queries/visionQuota', () => ({
    getQuota: jest.fn().mockResolvedValue({
        scansUsed: 0,
        scansRemaining: 50,
        monthlyLimit: 50,
        tokensUsed: 0,
        outputTokensUsed: 0,
        tokenLimit: 500000,
        outputTokenLimit: 100000,
        tokensRemaining: 500000,
        percentUsed: 0,
        periodStart: new Date().toISOString(),
        daysRemaining: 30,
    }),
    incrementTokenUsage: jest.fn().mockResolvedValue({
        scansUsed: 1,
        tokensUsed: 100,
        outputTokensUsed: 20,
        tokensRemaining: 499900,
        tokenLimit: 500000,
        outputTokenLimit: 100000,
    }),
    logTokenCalls: jest.fn().mockResolvedValue(undefined),
}));

describe('shelvesController', () => {
    let req, res;
    let mockPipelineInstance;

    async function createJpegBuffer(width = 100, height = 100) {
        return sharp({
            create: {
                width,
                height,
                channels: 3,
                background: { r: 30, g: 60, b: 90 },
            },
        }).jpeg().toBuffer();
    }

    beforeEach(() => {
        jest.clearAllMocks();
        query.mockReset();
        query.mockResolvedValue({ rows: [], rowCount: 0 });
        req = {
            user: { id: 1, isPremium: true },
            params: { shelfId: '10' },
            body: {
                imageBase64: 'data:image/jpeg;base64,aabbcc',
                async: false, // Use synchronous mode for predictable test assertions
            }
        };
        res = {
            json: jest.fn(),
            send: jest.fn(),
            setHeader: jest.fn(),
            status: jest.fn().mockReturnThis(),
            end: jest.fn(),
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

        shelvesQueries.getById.mockReset();
        shelvesQueries.getItems.mockReset();
        shelvesQueries.getForViewing.mockReset();
        shelvesQueries.getItemById.mockReset();
        shelvesQueries.removeItem.mockReset();
        shelvesQueries.addCollectable.mockReset();
        if (shelvesQueries.replaceOwnedPlatformsForCollectionItem) {
            shelvesQueries.replaceOwnedPlatformsForCollectionItem.mockReset();
        }
        if (shelvesQueries.updateCollectionItemGameDefaults) {
            shelvesQueries.updateCollectionItemGameDefaults.mockReset();
        }
        if (shelvesQueries.listCollectionItemsForDefaults) {
            shelvesQueries.listCollectionItemsForDefaults.mockReset();
        }
        shelvesQueries.addManual.mockReset();
        if (shelvesQueries.addManualCollection) {
            shelvesQueries.addManualCollection.mockReset();
        }
        if (shelvesQueries.findManualByFingerprint) {
            shelvesQueries.findManualByFingerprint.mockReset();
        }
        if (shelvesQueries.findManualByBarcode) {
            shelvesQueries.findManualByBarcode.mockReset();
        }
        if (shelvesQueries.fuzzyFindManualForOther) {
            shelvesQueries.fuzzyFindManualForOther.mockReset();
        }
        if (shelvesQueries.findManualCollection) {
            shelvesQueries.findManualCollection.mockReset();
        }
        if (shelvesQueries.getCollectionItemByIdForShelf) {
            shelvesQueries.getCollectionItemByIdForShelf.mockReset();
        }
        shelvesQueries.updateItemRating.mockReset();
        if (shelvesQueries.updateReviewedEventLink) {
            shelvesQueries.updateReviewedEventLink.mockReset();
        }
        shelvesQueries.findCollectionByReference.mockReset();
        collectablesQueries.findByLightweightFingerprint.mockReset();
        collectablesQueries.findById.mockReset();
        if (!collectablesQueries.fuzzyMatch) {
            collectablesQueries.fuzzyMatch = jest.fn();
        }
        collectablesQueries.fuzzyMatch.mockReset();
        collectablesQueries.upsert.mockReset();
        if (!collectablesQueries.updateFormat) {
            collectablesQueries.updateFormat = jest.fn();
        }
        collectablesQueries.updateFormat.mockReset();
        itemReplacementTracesQueries.createIntent.mockReset();
        itemReplacementTracesQueries.getByIdForUser.mockReset();
        itemReplacementTracesQueries.markCompleted.mockReset();
        itemReplacementTracesQueries.markFailed.mockReset();
        visionResultCacheQueries.getValid.mockReset();
        visionResultCacheQueries.set.mockReset();
        visionResultCacheQueries.deleteByHash.mockReset();
        visionScanPhotosQueries.upsertFromBuffer.mockReset();
        visionScanPhotosQueries.getByIdForUser.mockReset();
        visionScanPhotosQueries.loadImageBuffer.mockReset();
        visionScanPhotosQueries.deleteByHash.mockReset();
        visionItemRegionsQueries.countForScan.mockReset();
        visionItemRegionsQueries.listForScan.mockReset();
        visionItemRegionsQueries.getByIdForScan.mockReset();
        visionItemRegionsQueries.getByExtractionIndexForScan.mockReset();
        visionItemRegionsQueries.linkCollectable.mockReset();
        visionItemRegionsQueries.linkManual.mockReset();
        visionItemRegionsQueries.linkCollectionItem.mockReset();
        visionItemRegionsQueries.hasCollectionItemLinkForReference.mockReset();
        workflowQueueJobsQueries.enqueueJob.mockReset();
        workflowQueueJobsQueries.findActiveByDedupeKey.mockReset();
        workflowQueueJobsQueries.getByJobIdForUser.mockReset();
        workflowQueueJobsQueries.getQueuePosition.mockReset();
        workflowQueueJobsQueries.countQueuedForUser.mockReset();
        workflowQueueJobsQueries.countQueued.mockReset();
        workflowQueueJobsQueries.countRunning.mockReset();
        workflowQueueJobsQueries.requestAbort.mockReset();
        workflowQueueJobsQueries.updateNotifyOnComplete.mockReset();
        workflowQueueJobsQueries.updateNotifyInAppOnComplete.mockReset();
        workflowQueueJobsQueries.setInAppOnlyCompletionNotice.mockReset();
        workflowQueueJobsQueries.isAbortRequested.mockReset();
        userCollectionPhotosQueries.getByCollectionItem.mockReset();
        userCollectionPhotosQueries.loadOwnerPhotoThumbnailBuffer.mockReset();
        userCollectionPhotosQueries.upsertOwnerPhotoThumbnailForItem.mockReset();
        userCollectionPhotosQueries.attachVisionCropToItem.mockReset();
        shelfPhotosQueries.getByShelfId.mockReset();
        shelfPhotosQueries.uploadPhotoForShelf.mockReset();
        shelfPhotosQueries.clearPhotoForShelf.mockReset();
        shelfPhotosQueries.loadPhotoBuffer.mockReset();
        manualMediaQueries.uploadFromBuffer.mockReset();
        needsReviewQueries.getById.mockReset();
        needsReviewQueries.markCompleted.mockReset();
        ratingsQueries.getRating.mockReset();
        feedQueries.upsertReviewedEvent.mockReset();

        // Mock loadShelfForUser via the query it calls? 
        // Controller calls loadShelfForUser which calls shelvesQueries.getById
        shelvesQueries.getById.mockResolvedValue({ id: 10, type: 'book' });
        shelvesQueries.getItems.mockResolvedValue([]);
        if (shelvesQueries.getCollectionItemByIdForShelf) {
            shelvesQueries.getCollectionItemByIdForShelf.mockResolvedValue(null);
        }
        visionResultCacheQueries.getValid.mockResolvedValue(null);
        visionResultCacheQueries.deleteByHash.mockResolvedValue(0);
        visionScanPhotosQueries.upsertFromBuffer.mockResolvedValue({ id: 77 });
        visionScanPhotosQueries.getByIdForUser.mockResolvedValue(null);
        visionScanPhotosQueries.deleteByHash.mockResolvedValue({ deleted: false, deletedRows: 0 });
        visionItemRegionsQueries.countForScan.mockResolvedValue(0);
        visionItemRegionsQueries.listForScan.mockResolvedValue([]);
        visionItemRegionsQueries.getByIdForScan.mockResolvedValue(null);
        visionItemRegionsQueries.getByExtractionIndexForScan.mockResolvedValue(null);
        visionItemRegionsQueries.linkCollectable.mockResolvedValue(null);
        visionItemRegionsQueries.linkManual.mockResolvedValue(null);
        visionItemRegionsQueries.linkCollectionItem.mockResolvedValue(null);
        visionItemRegionsQueries.hasCollectionItemLinkForReference.mockResolvedValue(false);
        workflowQueueJobsQueries.enqueueJob.mockResolvedValue({
            jobId: 'test-job-id',
            status: 'queued',
            notifyOnComplete: false,
            notifyInAppOnComplete: false,
            payload: { scanPhotoId: 77 },
        });
        workflowQueueJobsQueries.findActiveByDedupeKey.mockResolvedValue(null);
        workflowQueueJobsQueries.getByJobIdForUser.mockResolvedValue(null);
        workflowQueueJobsQueries.getQueuePosition.mockResolvedValue(1);
        workflowQueueJobsQueries.countQueuedForUser.mockResolvedValue(0);
        workflowQueueJobsQueries.countQueued.mockResolvedValue(0);
        workflowQueueJobsQueries.countRunning.mockResolvedValue(0);
        workflowQueueJobsQueries.requestAbort.mockResolvedValue(null);
        workflowQueueJobsQueries.updateNotifyOnComplete.mockResolvedValue({
            jobId: 'test-job-id',
            status: 'queued',
            notifyOnComplete: true,
            notifyInAppOnComplete: false,
            payload: { scanPhotoId: 77 },
        });
        workflowQueueJobsQueries.updateNotifyInAppOnComplete.mockResolvedValue({
            jobId: 'test-job-id',
            status: 'queued',
            notifyOnComplete: false,
            notifyInAppOnComplete: true,
            payload: { scanPhotoId: 77 },
        });
        workflowQueueJobsQueries.setInAppOnlyCompletionNotice.mockResolvedValue({
            jobId: 'test-job-id',
            status: 'queued',
            notifyOnComplete: false,
            notifyInAppOnComplete: true,
            payload: { scanPhotoId: 77 },
        });
        workflowQueueJobsQueries.isAbortRequested.mockResolvedValue(false);
        getWorkflowQueueSettings.mockResolvedValue({
            workflowQueueMaxRunning: 2,
            workflowQueueMaxRunningPerUser: 1,
            workflowQueueMaxQueuedPerUser: 4,
            workflowQueueLongThresholdPosition: 3,
            workflowQueueNotifyMinWaitMs: 20000,
            workflowQueueRetryMaxAttempts: 1,
            workflowQueueTerminalRetentionMs: 24 * 60 * 60 * 1000,
        });
        needsReviewQueries.getById.mockResolvedValue(null);
        needsReviewQueries.markCompleted.mockResolvedValue(true);
        ratingsQueries.getRating.mockResolvedValue({ rating: null });
        feedQueries.upsertReviewedEvent.mockResolvedValue({
            id: 901,
            reviewPublishedAt: '2026-03-25T20:00:00.000Z',
            reviewUpdatedAt: '2026-03-25T20:00:00.000Z',
            changed: true,
            createdNew: true,
        });
        collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
        collectablesQueries.fuzzyMatch.mockResolvedValue(null);
        shelvesQueries.getForViewing.mockResolvedValue({ id: 10, ownerId: 1, visibility: 'private' });
        shelvesQueries.getItemById.mockResolvedValue({ id: 55, userId: 1, shelfId: 10 });
        if (shelvesQueries.updateReviewedEventLink) {
            shelvesQueries.updateReviewedEventLink.mockResolvedValue(null);
        }
        shelvesQueries.removeItem.mockResolvedValue(true);
        if (shelvesQueries.replaceOwnedPlatformsForCollectionItem) {
            shelvesQueries.replaceOwnedPlatformsForCollectionItem.mockResolvedValue([]);
        }
        if (shelvesQueries.updateCollectionItemGameDefaults) {
            shelvesQueries.updateCollectionItemGameDefaults.mockResolvedValue({ id: 55, format: null, platformMissing: false });
        }
        if (shelvesQueries.listCollectionItemsForDefaults) {
            shelvesQueries.listCollectionItemsForDefaults.mockResolvedValue([]);
        }
        itemReplacementTracesQueries.createIntent.mockResolvedValue(null);
        itemReplacementTracesQueries.getByIdForUser.mockResolvedValue(null);
        itemReplacementTracesQueries.markCompleted.mockResolvedValue(null);
        itemReplacementTracesQueries.markFailed.mockResolvedValue(null);
        userCollectionPhotosQueries.getByCollectionItem.mockResolvedValue(null);
        userCollectionPhotosQueries.loadOwnerPhotoThumbnailBuffer.mockReset();
        userCollectionPhotosQueries.upsertOwnerPhotoThumbnailForItem.mockReset();
        userCollectionPhotosQueries.attachVisionCropToItem.mockResolvedValue(null);
        shelfPhotosQueries.getByShelfId.mockResolvedValue(null);
        shelfPhotosQueries.uploadPhotoForShelf.mockResolvedValue(null);
        shelfPhotosQueries.clearPhotoForShelf.mockResolvedValue(null);
        manualMediaQueries.uploadFromBuffer.mockResolvedValue(null);
    });

    describe('createShelf', () => {
        it('requires description when creating an other shelf', async () => {
            req.body = { name: 'Spirits', type: 'other', description: '   ' };

            await shelvesController.createShelf(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Description is required when shelf type is "other".',
            });
            expect(shelvesQueries.create).not.toHaveBeenCalled();
        });

        it('validates games gameDefaults payload', async () => {
            req.body = {
                name: 'Games',
                type: 'games',
                gameDefaults: { platformType: 'custom', customPlatformText: '   ' },
            };

            await shelvesController.createShelf(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.stringContaining('customPlatformText is required'),
            }));
            expect(shelvesQueries.create).not.toHaveBeenCalled();
        });
    });

    describe('listShelves', () => {
        it('uses default sorting and pagination when params are missing', async () => {
            req.query = {};
            query.mockResolvedValueOnce({
                rows: [{ id: 2, name: 'B', type: 'books', item_count: '3' }],
                rowCount: 1,
            });
            query.mockResolvedValueOnce({
                rows: [{ total: '1' }],
                rowCount: 1,
            });

            await shelvesController.listShelves(req, res);

            const [sql, params] = query.mock.calls[0];
            expect(sql).toContain('ORDER BY s.created_at DESC, s.id DESC');
            expect(params).toEqual([1, 50, 0]);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                pagination: expect.objectContaining({
                    limit: 50,
                    skip: 0,
                    total: 1,
                    hasMore: false,
                }),
                sort: { sortBy: 'createdAt', sortDir: 'desc' },
            }));
            expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=0, must-revalidate');
            expect(res.setHeader).toHaveBeenCalledWith('ETag', expect.any(String));
        });

        it('accepts explicit sortBy/sortDir and returns pagination metadata', async () => {
            req.query = { sortBy: 'name', sortDir: 'asc', limit: '10', skip: '20' };
            query.mockResolvedValueOnce({
                rows: [{ id: 10, name: 'Alpha', type: 'books', item_count: '2' }],
                rowCount: 1,
            });
            query.mockResolvedValueOnce({
                rows: [{ total: '30' }],
                rowCount: 1,
            });

            await shelvesController.listShelves(req, res);

            const [sql, params] = query.mock.calls[0];
            expect(sql).toContain('ORDER BY LOWER(s.name) ASC, s.id ASC');
            expect(params).toEqual([1, 10, 20]);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                pagination: expect.objectContaining({
                    limit: 10,
                    skip: 20,
                    total: 30,
                    hasMore: true,
                }),
                sort: { sortBy: 'name', sortDir: 'asc' },
            }));
        });

        it('includes normalized shelfPhoto contract fields', async () => {
            req.query = {};
            query.mockResolvedValueOnce({
                rows: [{
                    id: 2,
                    name: 'Decor Shelf',
                    type: 'books',
                    item_count: '3',
                    photo_storage_provider: 'local',
                    photo_storage_key: 'shelf-photos/u1/2/abc.jpg',
                    photo_content_type: 'image/jpeg',
                    photo_size_bytes: 12345,
                    photo_width: 640,
                    photo_height: 480,
                    photo_updated_at: '2026-04-01T10:00:00.000Z',
                }],
                rowCount: 1,
            });
            query.mockResolvedValueOnce({
                rows: [{ total: '1' }],
                rowCount: 1,
            });

            await shelvesController.listShelves(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                shelves: expect.arrayContaining([
                    expect.objectContaining({
                        id: 2,
                        shelfPhoto: expect.objectContaining({
                            hasPhoto: true,
                            contentType: 'image/jpeg',
                            sizeBytes: 12345,
                            width: 640,
                            height: 480,
                            imageUrl: '/api/shelves/2/photo/image',
                        }),
                    }),
                ]),
            }));
        });

        it('accepts all supported sortBy + sortDir combinations', async () => {
            const expectedSqlBySort = {
                type: 'ORDER BY s.type',
                name: 'ORDER BY LOWER(s.name)',
                createdAt: 'ORDER BY s.created_at',
                updatedAt: 'ORDER BY s.updated_at',
            };
            const sortFields = ['type', 'name', 'createdAt', 'updatedAt'];
            const sortDirections = ['asc', 'desc'];

            for (const sortField of sortFields) {
                for (const direction of sortDirections) {
                    query.mockReset();
                    query.mockResolvedValueOnce({
                        rows: [{ id: 1, name: 'Shelf', type: 'games', item_count: '1' }],
                        rowCount: 1,
                    });
                    query.mockResolvedValueOnce({
                        rows: [{ total: '1' }],
                        rowCount: 1,
                    });
                    req.query = { sortBy: sortField, sortDir: direction, limit: '5', skip: '0' };
                    res.json.mockClear();

                    await shelvesController.listShelves(req, res);

                    const [sql] = query.mock.calls[0];
                    expect(sql).toContain(expectedSqlBySort[sortField]);
                    if (direction === 'asc') {
                        expect(sql).toContain('s.id ASC');
                    } else {
                        expect(sql).toContain('s.id DESC');
                    }
                    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                        sort: { sortBy: sortField, sortDir: direction },
                    }));
                }
            }
        });

        it('falls back to default sort when invalid sort params are provided', async () => {
            req.query = { sortBy: 'bad', sortDir: 'up' };
            query.mockResolvedValueOnce({
                rows: [{ id: 1, name: 'Shelf', type: 'games', item_count: '0' }],
                rowCount: 1,
            });
            query.mockResolvedValueOnce({
                rows: [{ total: '1' }],
                rowCount: 1,
            });

            await shelvesController.listShelves(req, res);

            const [sql] = query.mock.calls[0];
            expect(sql).toContain('ORDER BY s.created_at DESC, s.id DESC');
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                sort: { sortBy: 'createdAt', sortDir: 'desc' },
            }));
        });

        it('returns 304 when if-none-match matches computed ETag', async () => {
            req.query = { sortBy: 'updatedAt', sortDir: 'desc', limit: '5', skip: '0' };
            query.mockResolvedValueOnce({
                rows: [{ id: 9, name: 'Recent', type: 'movies', item_count: '5' }],
                rowCount: 1,
            });
            query.mockResolvedValueOnce({
                rows: [{ total: '1' }],
                rowCount: 1,
            });

            await shelvesController.listShelves(req, res);

            const etagCall = res.setHeader.mock.calls.find(([key]) => key === 'ETag');
            expect(etagCall).toBeTruthy();
            const etagValue = etagCall[1];

            query.mockReset();
            query.mockResolvedValueOnce({
                rows: [{ id: 9, name: 'Recent', type: 'movies', item_count: '5' }],
                rowCount: 1,
            });
            query.mockResolvedValueOnce({
                rows: [{ total: '1' }],
                rowCount: 1,
            });
            req.headers = { 'if-none-match': etagValue };
            res.json.mockClear();
            res.status.mockClear();
            res.end.mockClear();
            res.setHeader.mockClear();

            await shelvesController.listShelves(req, res);

            expect(res.status).toHaveBeenCalledWith(304);
            expect(res.end).toHaveBeenCalled();
            expect(res.json).not.toHaveBeenCalled();
        });
    });

    describe('updateShelf', () => {
        it('requires description when updating an other shelf', async () => {
            req.params = { shelfId: '10' };
            req.body = { description: '' };
            shelvesQueries.getById.mockResolvedValue({
                id: 10,
                ownerId: 1,
                type: 'other',
                description: 'Original description',
            });

            await shelvesController.updateShelf(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Description is required when shelf type is "other".',
            });
            expect(shelvesQueries.update).not.toHaveBeenCalled();
        });

        it('reapplies defaults to existing items when games defaults change', async () => {
            req.params = { shelfId: '10' };
            req.body = {
                gameDefaults: { platformType: 'xbox', format: 'digital' },
            };
            shelvesQueries.getById.mockResolvedValue({
                id: 10,
                ownerId: 1,
                type: 'games',
                gameDefaults: { platformType: 'playstation', format: 'physical' },
            });
            shelvesQueries.update.mockResolvedValue({
                id: 10,
                ownerId: 1,
                type: 'games',
                gameDefaults: { platformType: 'xbox', format: 'digital' },
            });
            shelvesQueries.listCollectionItemsForDefaults.mockResolvedValue([
                {
                    id: 99,
                    collectableId: 301,
                    collectableKind: 'games',
                    collectableSystemName: 'Xbox Series X|S',
                    collectablePlatformData: [{ name: 'Xbox Series X|S' }],
                },
            ]);

            await shelvesController.updateShelf(req, res);

            expect(shelvesQueries.listCollectionItemsForDefaults).toHaveBeenCalledWith({
                userId: 1,
                shelfId: 10,
            }, expect.any(Object));
            expect(shelvesQueries.replaceOwnedPlatformsForCollectionItem).toHaveBeenCalledWith({
                collectionItemId: 99,
                userId: 1,
                shelfId: 10,
                platforms: ['Xbox'],
            }, expect.any(Object));
            expect(shelvesQueries.updateCollectionItemGameDefaults).toHaveBeenCalledWith({
                collectionItemId: 99,
                userId: 1,
                shelfId: 10,
                format: 'digital',
                platformMissing: false,
            }, expect.any(Object));
        });
    });

    describe('shelf photos', () => {
        it('includes shelfPhoto in getShelf responses', async () => {
            req.params = { shelfId: '10' };
            req.user = { id: 1 };
            shelvesQueries.getForViewing.mockResolvedValue({
                id: 10,
                ownerId: 1,
                name: 'Books',
                type: 'books',
                visibility: 'private',
                photoStorageProvider: 'local',
                photoStorageKey: 'shelf-photos/1/10/photo.jpg',
                photoContentType: 'image/jpeg',
                photoSizeBytes: 100,
                photoWidth: 1200,
                photoHeight: 900,
                photoUpdatedAt: '2026-04-01T12:00:00.000Z',
            });

            await shelvesController.getShelf(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                shelf: expect.objectContaining({
                    id: 10,
                    shelfPhoto: expect.objectContaining({
                        hasPhoto: true,
                        imageUrl: '/api/shelves/10/photo/image',
                    }),
                }),
            }));
        });

        it('uploads a shelf photo for owners', async () => {
            req.params = { shelfId: '10' };
            req.file = { buffer: Buffer.from('photo'), mimetype: 'image/jpeg' };
            shelvesQueries.getById.mockResolvedValue({
                id: 10,
                ownerId: 1,
                type: 'books',
            });
            shelfPhotosQueries.uploadPhotoForShelf.mockResolvedValue({
                id: 10,
                ownerId: 1,
                photoStorageProvider: 'local',
                photoStorageKey: 'shelf-photos/1/10/abcd.jpg',
                photoContentType: 'image/jpeg',
                photoSizeBytes: 5000,
                photoWidth: 800,
                photoHeight: 600,
                photoUpdatedAt: '2026-04-01T12:00:00.000Z',
            });

            await shelvesController.uploadShelfPhoto(req, res);

            expect(shelfPhotosQueries.uploadPhotoForShelf).toHaveBeenCalledWith({
                shelfId: 10,
                userId: 1,
                buffer: req.file.buffer,
                contentType: 'image/jpeg',
            });
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                shelfPhoto: expect.objectContaining({
                    hasPhoto: true,
                    imageUrl: '/api/shelves/10/photo/image',
                }),
            }));
        });

        it('rejects upload when no file is provided', async () => {
            req.params = { shelfId: '10' };
            req.file = null;
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'books' });

            await shelvesController.uploadShelfPhoto(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'No image file provided' });
        });

        it('returns 404 on photo metadata request when shelf is not viewable', async () => {
            req.params = { shelfId: '10' };
            shelvesQueries.getForViewing.mockResolvedValue(null);

            await shelvesController.getShelfPhoto(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Shelf not found' });
        });

        it('returns shelf photo bytes for viewable shelves', async () => {
            req.params = { shelfId: '10' };
            const imageBuffer = Buffer.from('image');
            shelvesQueries.getForViewing.mockResolvedValue({
                id: 10,
                ownerId: 1,
                photoStorageProvider: 'local',
                photoStorageKey: 'shelf-photos/1/10/abcd.jpg',
                photoContentType: 'image/jpeg',
            });
            shelfPhotosQueries.loadPhotoBuffer.mockResolvedValue({
                buffer: imageBuffer,
                contentType: 'image/jpeg',
                contentLength: imageBuffer.length,
            });

            await shelvesController.getShelfPhotoImage(req, res);

            expect(shelfPhotosQueries.loadPhotoBuffer).toHaveBeenCalled();
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
            expect(res.send).toHaveBeenCalledWith(imageBuffer);
        });

        it('returns 404 when deleting shelf photo as non-owner', async () => {
            req.params = { shelfId: '10' };
            shelvesQueries.getById.mockResolvedValue(null);

            await shelvesController.deleteShelfPhoto(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Shelf not found' });
        });
    });

    describe('add item feed payloads', () => {
        it('logs normalized item.manual_added payload with creator/year/media fields', async () => {
            req.params = { shelfId: '10' };
            req.body = { name: 'Manual Item', year: 1998 };
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'other', visibility: 'public' });
            shelvesQueries.addManual.mockResolvedValue({
                collection: { id: 211 },
                manual: {
                    id: 311,
                    name: 'Manual Item',
                    author: 'Manual Creator',
                    year: 1998,
                    type: 'other',
                    coverMediaPath: 'manuals/311.jpg',
                },
            });

            await shelvesController.addManualEntry(req, res);

            expect(feedQueries.logEvent).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'item.manual_added',
                payload: expect.objectContaining({
                    itemId: 211,
                    manualId: 311,
                    title: 'Manual Item',
                    name: 'Manual Item',
                    creator: 'Manual Creator',
                    year: 1998,
                    coverMediaPath: 'manuals/311.jpg',
                    source: 'manual',
                }),
            }));
        });

        it('logs normalized item.collectable_added payload with creator/year/cover fields', async () => {
            req.params = { shelfId: '10' };
            req.body = { collectableId: 451 };
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'books', visibility: 'public' });
            collectablesQueries.findById.mockResolvedValue({
                id: 451,
                title: 'Collectable Item',
                primaryCreator: 'Collectable Creator',
                year: 2007,
                kind: 'books',
                coverUrl: 'https://img.example/cover.jpg',
                coverMediaPath: 'covers/451.jpg',
            });
            shelvesQueries.addCollectable.mockResolvedValue({
                id: 551,
                position: null,
                format: null,
                notes: null,
                rating: null,
            });

            await shelvesController.addCollectable(req, res);

            expect(feedQueries.logEvent).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'item.collectable_added',
                payload: expect.objectContaining({
                    itemId: 551,
                    collectableId: 451,
                    title: 'Collectable Item',
                    name: 'Collectable Item',
                    creator: 'Collectable Creator',
                    year: 2007,
                    coverUrl: 'https://img.example/cover.jpg',
                    coverMediaPath: 'covers/451.jpg',
                    source: 'user',
                }),
            }));
        });
    });

    describe('games shelf defaults', () => {
        it('applies matching games defaults when adding a collectable', async () => {
            req.params = { shelfId: '10' };
            req.body = { collectableId: 777 };
            shelvesQueries.getById.mockResolvedValue({
                id: 10,
                ownerId: 1,
                type: 'games',
                visibility: 'public',
                gameDefaults: { platformType: 'xbox', format: 'digital' },
            });
            collectablesQueries.findById.mockResolvedValue({
                id: 777,
                title: 'Halo Infinite',
                primaryCreator: '343 Industries',
                year: 2021,
                kind: 'games',
                systemName: 'Xbox Series X',
            });
            shelvesQueries.addCollectable.mockResolvedValue({
                id: 888,
                position: null,
                format: null,
                notes: null,
                rating: null,
            });
            shelvesQueries.replaceOwnedPlatformsForCollectionItem.mockResolvedValue(['Xbox']);

            await shelvesController.addCollectable(req, res);

            expect(shelvesQueries.replaceOwnedPlatformsForCollectionItem).toHaveBeenCalledWith({
                collectionItemId: 888,
                userId: 1,
                shelfId: 10,
                platforms: ['Xbox'],
            }, null);
            expect(shelvesQueries.updateCollectionItemGameDefaults).toHaveBeenCalledWith({
                collectionItemId: 888,
                userId: 1,
                shelfId: 10,
                format: 'digital',
                platformMissing: false,
            }, null);
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                item: expect.objectContaining({
                    id: 888,
                    ownedPlatforms: ['Xbox'],
                    platformMissing: false,
                }),
            }));
        });

        it('sets platformMissing and leaves format/platform blank when shelf platform mismatches collectable', async () => {
            req.params = { shelfId: '10' };
            req.body = { collectableId: 777 };
            shelvesQueries.getById.mockResolvedValue({
                id: 10,
                ownerId: 1,
                type: 'games',
                visibility: 'public',
                gameDefaults: { platformType: 'playstation', format: 'physical' },
            });
            collectablesQueries.findById.mockResolvedValue({
                id: 777,
                title: 'Halo Infinite',
                kind: 'games',
                systemName: 'Xbox Series X',
                platformData: [{ name: 'Xbox Series X|S' }],
            });
            shelvesQueries.addCollectable.mockResolvedValue({
                id: 888,
                position: null,
                format: null,
                notes: null,
                rating: null,
            });
            shelvesQueries.replaceOwnedPlatformsForCollectionItem.mockResolvedValue([]);

            await shelvesController.addCollectable(req, res);

            expect(shelvesQueries.updateCollectionItemGameDefaults).toHaveBeenCalledWith({
                collectionItemId: 888,
                userId: 1,
                shelfId: 10,
                format: null,
                platformMissing: true,
            }, null);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                item: expect.objectContaining({
                    id: 888,
                    format: null,
                    platformMissing: true,
                    ownedPlatforms: [],
                }),
            }));
        });
    });

    describe('updateOwnedPlatforms', () => {
        it('updates owned platforms for a game shelf item', async () => {
            req.params = { shelfId: '10', itemId: '55' };
            req.body = { platforms: ['PlayStation 5', 'PS5', 'PlayStation 5'], format: 'Physical' };
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'games' });
            shelvesQueries.getItemById
                .mockResolvedValueOnce({
                    id: 55,
                    collectableId: 900,
                    collectableKind: 'games',
                })
                .mockResolvedValueOnce({
                    id: 55,
                    shelfId: 10,
                    collectableId: 900,
                    collectableKind: 'games',
                    ownedPlatforms: ['PS5', 'PlayStation 5'],
                });
            shelvesQueries.replaceOwnedPlatformsForCollectionItem.mockResolvedValue(['PS5', 'PlayStation 5']);
            collectablesQueries.updateFormat.mockResolvedValue({ id: 900, format: 'physical' });

            await shelvesController.updateOwnedPlatforms(req, res);

            expect(shelvesQueries.replaceOwnedPlatformsForCollectionItem).toHaveBeenCalledWith({
                collectionItemId: 55,
                userId: 1,
                shelfId: 10,
                platforms: ['PlayStation 5', 'PS5'],
            });
            expect(shelvesQueries.updateCollectionItemGameDefaults).toHaveBeenCalledWith({
                collectionItemId: 55,
                userId: 1,
                shelfId: 10,
                format: 'physical',
                platformMissing: false,
            });
            expect(collectablesQueries.updateFormat).toHaveBeenCalledWith(900, 'physical');
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                item: expect.objectContaining({
                    id: 55,
                    ownedPlatforms: ['PS5', 'PlayStation 5'],
                    platformMissing: false,
                    collectable: expect.objectContaining({
                        format: 'physical',
                    }),
                }),
            }));
        });

        it('updates collectable format when provided', async () => {
            req.params = { shelfId: '10', itemId: '55' };
            req.body = { platforms: ['PlayStation 5'], format: 'Digital' };
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'games' });
            shelvesQueries.getItemById
                .mockResolvedValueOnce({
                    id: 55,
                    collectableId: 900,
                    collectableKind: 'games',
                })
                .mockResolvedValueOnce({
                    id: 55,
                    shelfId: 10,
                    collectableId: 900,
                    collectableKind: 'games',
                });
            shelvesQueries.replaceOwnedPlatformsForCollectionItem.mockResolvedValue(['PlayStation 5']);
            collectablesQueries.updateFormat.mockResolvedValue({ id: 900, format: 'digital' });

            await shelvesController.updateOwnedPlatforms(req, res);

            expect(collectablesQueries.updateFormat).toHaveBeenCalledWith(900, 'digital');
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                item: expect.objectContaining({
                    id: 55,
                    ownedPlatforms: ['PlayStation 5'],
                    platformMissing: false,
                    collectable: expect.objectContaining({
                        format: 'digital',
                    }),
                }),
            }));
        });

        it('rejects owned platform updates for non-game collectables', async () => {
            req.params = { shelfId: '10', itemId: '55' };
            req.body = { platforms: ['PlayStation 5'] };
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'books' });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 55,
                collectableId: 900,
                collectableKind: 'books',
            });

            await shelvesController.updateOwnedPlatforms(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(shelvesQueries.replaceOwnedPlatformsForCollectionItem).not.toHaveBeenCalled();
        });

        it('rejects invalid owned-platform format values', async () => {
            req.params = { shelfId: '10', itemId: '55' };
            req.body = { platforms: ['PlayStation 5'], format: 'Steam Key' };
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'games' });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 55,
                collectableId: 900,
                collectableKind: 'games',
            });

            await shelvesController.updateOwnedPlatforms(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(shelvesQueries.replaceOwnedPlatformsForCollectionItem).not.toHaveBeenCalled();
            expect(collectablesQueries.updateFormat).not.toHaveBeenCalled();
        });

        it('rejects missing owned-platform format', async () => {
            req.params = { shelfId: '10', itemId: '55' };
            req.body = { platforms: ['PlayStation 5'] };
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'games' });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 55,
                collectableId: 900,
                collectableKind: 'games',
            });

            await shelvesController.updateOwnedPlatforms(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(shelvesQueries.replaceOwnedPlatformsForCollectionItem).not.toHaveBeenCalled();
            expect(collectablesQueries.updateFormat).not.toHaveBeenCalled();
        });
    });

    describe('rateShelfItem', () => {
        beforeEach(() => {
            req.params = { shelfId: '10', itemId: '55' };
            req.body = { rating: 4 };
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'books', visibility: 'public' });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 55,
                collectableId: 101,
                collectableTitle: 'The Item',
                collectableCreator: 'The Creator',
                collectableKind: 'book',
                collectableCover: null,
                collectableCoverImageUrl: null,
                collectableCoverImageSource: null,
                collectableCoverMediaPath: null,
            });
        });

        it('logs once for initial rating and skips unchanged repeats on legacy shelf-rating endpoint', async () => {
            shelvesQueries.updateItemRating
                .mockResolvedValueOnce({ id: 55, rating: 4, previousRating: null })
                .mockResolvedValueOnce({ id: 55, rating: 4, previousRating: 4 });

            await shelvesController.rateShelfItem(req, res);
            await shelvesController.rateShelfItem(req, res);

            expect(feedQueries.logEvent).toHaveBeenCalledTimes(1);
            expect(feedQueries.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 1,
                    shelfId: null,
                    eventType: 'item.rated',
                }),
            );
        });

        it('updates notes without changing rating or logging rating feed events', async () => {
            req.body = { notes: '  shelf note  ' };
            feedQueries.logEvent.mockClear();
            shelvesQueries.updateItemRating.mockResolvedValue({
                id: 55,
                rating: 4,
                previousRating: 4,
                notes: 'shelf note',
            });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 55,
                notes: 'shelf note',
                collectableId: 101,
                collectableTitle: 'The Item',
                collectableCreator: 'The Creator',
                collectableKind: 'book',
            });

            await shelvesController.rateShelfItem(req, res);

            expect(shelvesQueries.updateItemRating).toHaveBeenCalledWith(55, 1, 10, {
                notes: 'shelf note',
            });
            expect(feedQueries.logEvent).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                item: expect.objectContaining({
                    notes: 'shelf note',
                }),
            }));
        });

        it('logs reviewed event when shareToFeed is true and non-empty notes are saved', async () => {
            req.body = { notes: 'shared note', shareToFeed: true };
            feedQueries.logEvent.mockClear();
            feedQueries.upsertReviewedEvent.mockClear();
            shelvesQueries.updateItemRating.mockResolvedValue({
                id: 55,
                rating: 4,
                previousRating: 4,
                notes: 'shared note',
            });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 55,
                notes: 'shared note',
                collectableId: 101,
                collectableTitle: 'The Item',
                collectableCreator: 'The Creator',
                collectableKind: 'book',
                collectableCover: null,
                collectableCoverImageUrl: null,
                collectableCoverImageSource: null,
                collectableCoverMediaPath: null,
            });
            ratingsQueries.getRating.mockResolvedValue({ rating: 4.5 });
            shelvesQueries.updateReviewedEventLink.mockResolvedValue({
                reviewedEventLogId: 901,
                reviewedEventPublishedAt: '2026-03-25T20:00:00.000Z',
                reviewedEventUpdatedAt: '2026-03-25T20:00:00.000Z',
            });

            await shelvesController.rateShelfItem(req, res);

            expect(feedQueries.logEvent).not.toHaveBeenCalled();
            expect(feedQueries.upsertReviewedEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 1,
                    payload: expect.objectContaining({
                        itemId: 55,
                        sourceShelfId: 10,
                        collectableId: 101,
                        notes: 'shared note',
                        rating: 4.5,
                    }),
                }),
            );
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                item: expect.objectContaining({
                    reviewedEventId: 901,
                    reviewPublishedAt: '2026-03-25T20:00:00.000Z',
                    reviewUpdatedAt: '2026-03-25T20:00:00.000Z',
                }),
            }));
        });

        it('does not log reviewed event when shared save clears notes', async () => {
            req.body = { notes: '   ', shareToFeed: true };
            feedQueries.logEvent.mockClear();
            feedQueries.upsertReviewedEvent.mockClear();
            shelvesQueries.updateItemRating.mockResolvedValue({
                id: 55,
                rating: 4,
                previousRating: 4,
                notes: null,
            });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 55,
                notes: null,
                collectableId: 101,
                collectableTitle: 'The Item',
                collectableCreator: 'The Creator',
                collectableKind: 'book',
            });

            await shelvesController.rateShelfItem(req, res);

            expect(feedQueries.logEvent).not.toHaveBeenCalled();
            expect(feedQueries.upsertReviewedEvent).not.toHaveBeenCalled();
        });

        it('falls back to collectable reference when itemId is not the shelf-collection row id', async () => {
            req.params = { shelfId: '10', itemId: '999' };
            req.body = { notes: 'abc', collectableId: 101 };
            shelvesQueries.updateItemRating.mockReset();
            shelvesQueries.findCollectionByReference.mockReset();
            shelvesQueries.getItemById.mockReset();
            feedQueries.logEvent.mockClear();
            shelvesQueries.updateItemRating
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 55, rating: 4, previousRating: 4, notes: 'abc' });
            shelvesQueries.findCollectionByReference.mockResolvedValue({ id: 55 });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 55,
                notes: 'abc',
                collectableId: 101,
                collectableTitle: 'The Item',
                collectableCreator: 'The Creator',
                collectableKind: 'book',
            });

            await shelvesController.rateShelfItem(req, res);

            expect(shelvesQueries.findCollectionByReference).toHaveBeenCalledWith({
                userId: 1,
                shelfId: 10,
                collectableId: 101,
            });
            expect(shelvesQueries.updateItemRating).toHaveBeenCalledWith(55, 1, 10, {
                notes: 'abc',
            });
            expect(shelvesQueries.getItemById).toHaveBeenCalledWith(55, 1, 10);
            expect(feedQueries.logEvent).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                item: expect.objectContaining({ id: 55, notes: 'abc' }),
            }));
        });

        it('falls back using itemId as collectable candidate for notes-only payloads without collectableId', async () => {
            req.params = { shelfId: '10', itemId: '101' };
            req.body = { notes: 'fallback-note' };
            shelvesQueries.updateItemRating.mockReset();
            shelvesQueries.findCollectionByReference.mockReset();
            shelvesQueries.getItemById.mockReset();
            feedQueries.logEvent.mockClear();
            shelvesQueries.updateItemRating
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 55, rating: 4, previousRating: 4, notes: 'fallback-note' });
            shelvesQueries.findCollectionByReference.mockResolvedValue({ id: 55 });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 55,
                notes: 'fallback-note',
                collectableId: 101,
                collectableTitle: 'The Item',
                collectableCreator: 'The Creator',
                collectableKind: 'book',
            });

            await shelvesController.rateShelfItem(req, res);

            expect(shelvesQueries.findCollectionByReference).toHaveBeenCalledWith({
                userId: 1,
                shelfId: 10,
                collectableId: 101,
            });
            expect(shelvesQueries.updateItemRating).toHaveBeenCalledWith(55, 1, 10, {
                notes: 'fallback-note',
            });
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                item: expect.objectContaining({ id: 55, notes: 'fallback-note' }),
            }));
        });
    });

    describe('createReplacementIntent', () => {
        beforeEach(() => {
            req.params = { shelfId: '10', itemId: '55' };
            req.body = { triggerSource: 'collectable_detail' };
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'books' });
        });

        it('creates an initiated trace for eligible vision-linked detail items', async () => {
            shelvesQueries.getItemById.mockResolvedValue({
                id: 55,
                collectableId: 101,
                manualId: null,
                isVisionLinked: true,
                createdAt: new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(),
            });
            itemReplacementTracesQueries.createIntent.mockResolvedValue({
                id: 123,
                status: 'initiated',
            });

            await shelvesController.createReplacementIntent(req, res);

            expect(itemReplacementTracesQueries.createIntent).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 1,
                    shelfId: 10,
                    sourceItemId: 55,
                    triggerSource: 'collectable_detail',
                }),
            );
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                traceId: 123,
            }));
        });

        it('rejects detail-trigger intents for non vision-linked items', async () => {
            shelvesQueries.getItemById.mockResolvedValue({
                id: 55,
                collectableId: 101,
                manualId: null,
                isVisionLinked: false,
                createdAt: new Date().toISOString(),
            });

            await shelvesController.createReplacementIntent(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Replacement from detail is only available for vision-linked items.',
            });
            expect(itemReplacementTracesQueries.createIntent).not.toHaveBeenCalled();
        });

        it('rejects shelf-delete intents when source item is older than 24h window', async () => {
            req.body = { triggerSource: 'shelf_delete_modal' };
            shelvesQueries.getItemById.mockResolvedValue({
                id: 55,
                collectableId: 101,
                manualId: null,
                isVisionLinked: true,
                createdAt: new Date(Date.now() - (30 * 60 * 60 * 1000)).toISOString(),
            });

            await shelvesController.createReplacementIntent(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Replacement is only available within 24 hours for this action.',
            });
        });
    });

    describe('replaceShelfItem', () => {
        beforeEach(() => {
            req.params = { shelfId: '10', itemId: '55' };
            req.body = { traceId: 500, collectableId: 202 };
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'books' });
            shelvesQueries.getItemById
                .mockResolvedValueOnce({
                    id: 55,
                    collectableId: 101,
                    manualId: null,
                    createdAt: new Date().toISOString(),
                    isVisionLinked: true,
                })
                .mockResolvedValueOnce({
                    id: 88,
                    collectableId: 202,
                    manualId: null,
                });
            collectablesQueries.findById.mockResolvedValue({ id: 202, title: 'Replacement' });
            itemReplacementTracesQueries.getByIdForUser.mockResolvedValue({
                id: 500,
                status: 'initiated',
                sourceItemId: 55,
            });
            shelvesQueries.addCollectable.mockResolvedValue({ id: 88 });
            shelvesQueries.removeItem.mockResolvedValue(true);
            itemReplacementTracesQueries.markCompleted.mockResolvedValue({
                id: 500,
                status: 'completed',
            });
        });

        it('replaces source item with existing collectable and completes trace', async () => {
            await shelvesController.replaceShelfItem(req, res);

            expect(shelvesQueries.addCollectable).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 1,
                    shelfId: 10,
                    collectableId: 202,
                }),
                expect.any(Object),
            );
            expect(shelvesQueries.removeItem).toHaveBeenCalledWith(55, 1, 10, expect.any(Object));
            expect(itemReplacementTracesQueries.markCompleted).toHaveBeenCalledWith(
                expect.objectContaining({
                    traceId: 500,
                    userId: 1,
                    targetItemId: 88,
                    targetCollectableId: 202,
                    targetManualId: null,
                }),
                expect.any(Object),
            );
            expect(feedQueries.logEvent).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                replaced: true,
                sourceItemId: 55,
                targetItemId: 88,
            }));
        });

        it('does not remove source item when replacement resolves to same collection row', async () => {
            shelvesQueries.addCollectable.mockResolvedValue({ id: 55 });
            shelvesQueries.getItemById
                .mockReset()
                .mockResolvedValueOnce({
                    id: 55,
                    collectableId: 101,
                    manualId: null,
                    createdAt: new Date().toISOString(),
                    isVisionLinked: true,
                })
                .mockResolvedValueOnce({
                    id: 55,
                    collectableId: 202,
                    manualId: null,
                });

            await shelvesController.replaceShelfItem(req, res);

            expect(shelvesQueries.removeItem).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                replaced: false,
                targetItemId: 55,
            }));
        });

        it('supports manual replacement payloads', async () => {
            req.body = {
                traceId: 500,
                manual: {
                    name: 'Manual replacement',
                    type: 'other',
                    author: 'Creator',
                },
            };
            collectablesQueries.findById.mockReset();
            shelvesQueries.addManual.mockResolvedValue({
                collection: { id: 99 },
                manual: { id: 808 },
            });
            shelvesQueries.getItemById
                .mockReset()
                .mockResolvedValueOnce({
                    id: 55,
                    collectableId: 101,
                    manualId: null,
                    createdAt: new Date().toISOString(),
                    isVisionLinked: true,
                })
                .mockResolvedValueOnce({
                    id: 99,
                    collectableId: null,
                    manualId: 808,
                });
            itemReplacementTracesQueries.markCompleted.mockResolvedValue({
                id: 500,
                status: 'completed',
            });

            await shelvesController.replaceShelfItem(req, res);

            expect(shelvesQueries.addManual).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 1,
                    shelfId: 10,
                    name: 'Manual replacement',
                    type: 'other',
                }),
                expect.any(Object),
            );
            expect(itemReplacementTracesQueries.markCompleted).toHaveBeenCalledWith(
                expect.objectContaining({
                    targetItemId: 99,
                    targetCollectableId: null,
                    targetManualId: 808,
                }),
                expect.any(Object),
            );
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                targetItemId: 99,
            }));
        });

        it('marks trace failed when replacement intent lookup fails', async () => {
            itemReplacementTracesQueries.getByIdForUser.mockResolvedValue(null);

            await shelvesController.replaceShelfItem(req, res);

            expect(itemReplacementTracesQueries.markFailed).toHaveBeenCalledWith(
                expect.objectContaining({
                    traceId: 500,
                    userId: 1,
                    reason: 'replacement_trace_missing',
                }),
            );
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Replacement intent not found or already used' });
        });
    });

    describe('getVisionScanRegionCrop', () => {
        beforeEach(() => {
            req.params = { shelfId: '10', scanPhotoId: '77', regionId: '8' };
            visionScanPhotosQueries.getByIdForUser.mockResolvedValue({
                id: 77,
                shelfId: 10,
                width: 1200,
                height: 800,
                contentType: 'image/jpeg',
            });
            visionItemRegionsQueries.getByIdForScan.mockResolvedValue({
                id: 8,
                box2d: [100, 200, 700, 900],
            });
        });

        it('returns an existing crop when already generated', async () => {
            const cropBuffer = Buffer.from('existing-crop');
            visionItemCropsQueries.getByRegionIdForUser.mockResolvedValue({
                id: 901,
                regionId: 8,
                contentType: 'image/jpeg',
            });
            visionItemCropsQueries.loadImageBuffer.mockResolvedValue({
                buffer: cropBuffer,
                contentType: 'image/jpeg',
                contentLength: cropBuffer.length,
            });

            await shelvesController.getVisionScanRegionCrop(req, res);

            expect(visionScanPhotosQueries.loadImageBuffer).not.toHaveBeenCalled();
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
            expect(res.send).toHaveBeenCalledWith(cropBuffer);
        });

        it('generates and stores a crop lazily when none exists', async () => {
            visionItemCropsQueries.getByRegionIdForUser.mockResolvedValue(null);
            const scanBuffer = await createJpegBuffer(1200, 800);
            visionScanPhotosQueries.loadImageBuffer.mockResolvedValue({
                buffer: scanBuffer,
                contentType: 'image/jpeg',
                contentLength: scanBuffer.length,
            });
            visionItemCropsQueries.upsertFromBuffer.mockResolvedValue({
                id: 902,
                regionId: 8,
                contentType: 'image/jpeg',
            });

            await shelvesController.getVisionScanRegionCrop(req, res);

            expect(visionItemCropsQueries.upsertFromBuffer).toHaveBeenCalledWith(expect.objectContaining({
                userId: 1,
                shelfId: 10,
                scanPhotoId: 77,
                regionId: 8,
                contentType: 'image/jpeg',
                width: 840,
                height: 480,
            }));
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
            expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
        });

        it('accepts region box_2d payloads from persistence for crop extraction', async () => {
            visionItemRegionsQueries.getByIdForScan.mockResolvedValue({
                id: 8,
                box_2d: [100, 200, 700, 900],
            });
            visionItemCropsQueries.getByRegionIdForUser.mockResolvedValue(null);
            const scanBuffer = await createJpegBuffer(1200, 800);
            visionScanPhotosQueries.loadImageBuffer.mockResolvedValue({
                buffer: scanBuffer,
                contentType: 'image/jpeg',
                contentLength: scanBuffer.length,
            });

            await shelvesController.getVisionScanRegionCrop(req, res);

            expect(visionItemCropsQueries.upsertFromBuffer).toHaveBeenCalledWith(expect.objectContaining({
                regionId: 8,
                width: 840,
                height: 480,
            }));
            expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
        });

        it('skips manual cover promotion for other-shelf crops when owner photo is not shareable', async () => {
            const cropBuffer = Buffer.from('existing-crop');
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'other' });
            visionItemRegionsQueries.getByIdForScan.mockResolvedValue({
                id: 8,
                box2d: [100, 200, 700, 900],
                manualId: 808,
            });
            visionItemCropsQueries.getByRegionIdForUser.mockResolvedValue({
                id: 901,
                regionId: 8,
                contentType: 'image/jpeg',
            });
            visionItemCropsQueries.loadImageBuffer.mockResolvedValue({
                buffer: cropBuffer,
                contentType: 'image/jpeg',
                contentLength: cropBuffer.length,
            });
            shelvesQueries.findCollectionByReference.mockResolvedValue({ id: 55 });
            userCollectionPhotosQueries.attachVisionCropToItem.mockResolvedValue({
                id: 55,
                ownerPhotoSource: 'vision_crop',
                ownerPhotoVisible: false,
            });

            await shelvesController.getVisionScanRegionCrop(req, res);

            expect(userCollectionPhotosQueries.attachVisionCropToItem).toHaveBeenCalledWith(expect.objectContaining({
                itemId: 55,
                userId: 1,
                shelfId: 10,
                cropId: 901,
            }));
            expect(manualMediaQueries.uploadFromBuffer).not.toHaveBeenCalled();
            expect(res.send).toHaveBeenCalledWith(cropBuffer);
        });

        it('promotes manual cover for other-shelf crops when owner photo sharing is enabled', async () => {
            const cropBuffer = Buffer.from('existing-crop');
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'other' });
            visionItemRegionsQueries.getByIdForScan.mockResolvedValue({
                id: 8,
                box2d: [100, 200, 700, 900],
                manualId: 808,
            });
            visionItemCropsQueries.getByRegionIdForUser.mockResolvedValue({
                id: 901,
                regionId: 8,
                contentType: 'image/jpeg',
            });
            visionItemCropsQueries.loadImageBuffer.mockResolvedValue({
                buffer: cropBuffer,
                contentType: 'image/jpeg',
                contentLength: cropBuffer.length,
            });
            shelvesQueries.findCollectionByReference.mockResolvedValue({ id: 55 });
            userCollectionPhotosQueries.attachVisionCropToItem.mockResolvedValue({
                id: 55,
                ownerPhotoSource: 'vision_crop',
                ownerPhotoVisible: true,
            });

            await shelvesController.getVisionScanRegionCrop(req, res);

            expect(manualMediaQueries.uploadFromBuffer).toHaveBeenCalledWith(expect.objectContaining({
                userId: 1,
                manualId: 808,
                buffer: cropBuffer,
                contentType: 'image/jpeg',
            }));
            expect(res.send).toHaveBeenCalledWith(cropBuffer);
        });
    });

    describe('processShelfVision', () => {
        it('should return 400 when other shelf has no description', async () => {
            shelvesQueries.getById.mockResolvedValue({ id: 10, type: 'other', description: '   ' });

            await shelvesController.processShelfVision(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Description is required when shelf type is "other".',
            });
            expect(mockPipelineInstance.processImage).not.toHaveBeenCalled();
        });

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
                1,
                expect.any(String),
                expect.objectContaining({ scanPhotoId: 77 })
            );
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                visionStatus: { status: 'completed', provider: 'google-vision-gemini-pipeline' },
                scanPhotoId: 77,
            }));
        });

        it('should include hydrated shelf items in response', async () => {
            // getItems returns rows that are processed by formatShelfItem
            // Verify that items array is present in the response (hydration occurred)
            await shelvesController.processShelfVision(req, res);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                items: expect.any(Array)
            }));
            expect(shelvesQueries.getItems).toHaveBeenCalled();
        });

        it('returns 503 and purges image hash artifacts when all catalog providers are unavailable', async () => {
            mockPipelineInstance.processImage.mockRejectedValue(
                Object.assign(new Error('Catalog providers are temporarily unavailable. Please try this scan again later.'), {
                    code: 'CATALOG_PROVIDERS_UNAVAILABLE',
                }),
            );

            await shelvesController.processShelfVision(req, res);

            expect(visionResultCacheQueries.deleteByHash).toHaveBeenCalledWith(expect.objectContaining({
                userId: 1,
                shelfId: 10,
                imageSha256: expect.any(String),
            }));
            expect(visionScanPhotosQueries.deleteByHash).toHaveBeenCalledWith(expect.objectContaining({
                userId: 1,
                shelfId: 10,
                imageSha256: expect.any(String),
            }));
            expect(res.status).toHaveBeenCalledWith(503);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                code: 'CATALOG_PROVIDERS_UNAVAILABLE',
            }));
        });

        it('returns cached result and skips pipeline processing when image hash matches', async () => {
            visionResultCacheQueries.getValid.mockResolvedValue({
                resultJson: {
                    analysis: { shelfConfirmed: true },
                    results: { added: 0, existing: 2, needsReview: 0, extracted: 2 },
                    addedItems: [],
                    needsReview: [],
                },
            });

            await shelvesController.processShelfVision(req, res);

            expect(mockPipelineInstance.processImage).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                cached: true,
                existingCount: 2,
                summaryMessage: 'Same photo detected: this image was already scanned in the last 24 hours. Previous result: no new items added; 2 items already on this shelf.',
                scanPhotoId: 77,
            }));
        });

        it('enqueues uncached async vision jobs and returns queue metadata', async () => {
            req.body.async = true;

            await shelvesController.processShelfVision(req, res);

            expect(workflowQueueJobsQueries.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
                workflowType: 'vision',
                userId: 1,
                shelfId: 10,
                status: 'queued',
            }));
            expect(mockPipelineInstance.processImage).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(202);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                jobId: 'test-job-id',
                status: 'queued',
                queuePosition: 1,
                estimatedWaitSeconds: 0,
                notifyOnComplete: false,
                scanPhotoId: 77,
            }));
        });

        it('returns existing queued/processing job for duplicate in-flight image', async () => {
            req.body.async = true;
            workflowQueueJobsQueries.findActiveByDedupeKey.mockResolvedValue({
                jobId: 'dup-job-1',
                status: 'processing',
                notifyOnComplete: true,
                notifyInAppOnComplete: false,
                payload: { scanPhotoId: 88 },
            });
            workflowQueueJobsQueries.getQueuePosition.mockResolvedValue(0);

            await shelvesController.processShelfVision(req, res);

            expect(workflowQueueJobsQueries.enqueueJob).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(202);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                jobId: 'dup-job-1',
                status: 'processing',
                notifyOnComplete: true,
                scanPhotoId: 88,
            }));
        });

        it('enables in-app-only completion notice when queue position is 2', async () => {
            req.body.async = true;
            workflowQueueJobsQueries.getQueuePosition.mockResolvedValue(2);
            workflowQueueJobsQueries.setInAppOnlyCompletionNotice.mockResolvedValue({
                jobId: 'test-job-id',
                status: 'queued',
                notifyOnComplete: false,
                notifyInAppOnComplete: true,
                payload: { scanPhotoId: 77 },
            });

            await shelvesController.processShelfVision(req, res);

            expect(workflowQueueJobsQueries.setInAppOnlyCompletionNotice).toHaveBeenCalledWith({
                jobId: 'test-job-id',
            });
            expect(workflowQueueJobsQueries.updateNotifyOnComplete).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(202);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                jobId: 'test-job-id',
                status: 'queued',
                queuePosition: 2,
                notifyOnComplete: false,
                notifyInAppOnComplete: true,
            }));
        });

        it('returns 429 when per-user queued cap is reached', async () => {
            req.body.async = true;
            workflowQueueJobsQueries.countQueuedForUser.mockResolvedValue(4);
            getWorkflowQueueSettings.mockResolvedValue({
                workflowQueueMaxRunning: 2,
                workflowQueueMaxRunningPerUser: 1,
                workflowQueueMaxQueuedPerUser: 4,
                workflowQueueLongThresholdPosition: 3,
                workflowQueueNotifyMinWaitMs: 20000,
                workflowQueueRetryMaxAttempts: 1,
                workflowQueueTerminalRetentionMs: 24 * 60 * 60 * 1000,
            });

            await shelvesController.processShelfVision(req, res);

            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                code: 'workflow_queue_user_cap_exceeded',
            }));
        });
    });

    describe('vision status + abort', () => {
        beforeEach(() => {
            req.params = { shelfId: '10', jobId: 'job-queued-1' };
            processingStatus.getJob.mockReset();
            processingStatus.setJob.mockReset();
            processingStatus.abortJob.mockReset();
            processingStatus.getJob.mockReturnValue(null);
        });

        it('returns queue metadata from DB fallback when in-memory status is missing', async () => {
            workflowQueueJobsQueries.getByJobIdForUser.mockResolvedValue({
                jobId: 'job-queued-1',
                userId: 1,
                shelfId: 10,
                status: 'queued',
                createdAt: new Date().toISOString(),
                notifyOnComplete: true,
                notifyInAppOnComplete: false,
                result: null,
            });
            workflowQueueJobsQueries.getQueuePosition.mockResolvedValue(2);

            await shelvesController.getVisionStatus(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                jobId: 'job-queued-1',
                status: 'queued',
                queuePosition: 2,
                notifyOnComplete: true,
                notifyInAppOnComplete: false,
                queuedMs: expect.any(Number),
            }));
            expect(processingStatus.setJob).toHaveBeenCalled();
        });

        it('aborts queued DB-backed jobs', async () => {
            workflowQueueJobsQueries.getByJobIdForUser.mockResolvedValue({
                jobId: 'job-queued-1',
                userId: 1,
                shelfId: 10,
                status: 'queued',
                notifyOnComplete: false,
                notifyInAppOnComplete: false,
            });
            workflowQueueJobsQueries.requestAbort.mockResolvedValue({
                jobId: 'job-queued-1',
                userId: 1,
                shelfId: 10,
                status: 'aborted',
            });

            await shelvesController.abortVision(req, res);

            expect(workflowQueueJobsQueries.requestAbort).toHaveBeenCalledWith({
                jobId: 'job-queued-1',
                userId: 1,
            });
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                jobId: 'job-queued-1',
                aborted: true,
                status: 'aborted',
            }));
        });

        it('marks queued jobs as in-app-only when hidden to background', async () => {
            workflowQueueJobsQueries.getByJobIdForUser.mockResolvedValue({
                jobId: 'job-queued-1',
                userId: 1,
                shelfId: 10,
                status: 'queued',
                notifyOnComplete: false,
                notifyInAppOnComplete: false,
            });
            workflowQueueJobsQueries.setInAppOnlyCompletionNotice.mockResolvedValue({
                jobId: 'job-queued-1',
                userId: 1,
                shelfId: 10,
                status: 'queued',
                notifyOnComplete: false,
                notifyInAppOnComplete: true,
            });

            await shelvesController.setVisionBackground(req, res);

            expect(workflowQueueJobsQueries.setInAppOnlyCompletionNotice).toHaveBeenCalledWith({
                jobId: 'job-queued-1',
            });
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                jobId: 'job-queued-1',
                status: 'queued',
                notifyOnComplete: false,
                notifyInAppOnComplete: true,
            }));
        });
    });

    describe('processCatalogLookup', () => {
        beforeEach(() => {
            req.body = {
                items: [
                    { name: 'Dune', author: 'Frank Herbert', type: 'book' },
                    { name: 'Foundation', author: 'Isaac Asimov', type: 'book' },
                ],
            };
        });

        it('should return 400 when other shelf has no description', async () => {
            shelvesQueries.getById.mockResolvedValue({ id: 10, type: 'other', description: '' });

            await shelvesController.processCatalogLookup(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Description is required when shelf type is "other".',
            });
            expect(mockPipelineInstance.processImage).not.toHaveBeenCalled();
        });

        it('should return 404 if shelf is not found', async () => {
            shelvesQueries.getById.mockResolvedValue(null);
            await shelvesController.processCatalogLookup(req, res);
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Shelf not found' });
        });

        it('should return 400 if items array is missing', async () => {
            req.body = {};
            await shelvesController.processCatalogLookup(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'items array is required' });
        });

        it('should return 400 if items array is empty', async () => {
            req.body = { items: [] };
            await shelvesController.processCatalogLookup(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'items array is required' });
        });

        it('should call pipeline.processImage with null imageBase64 and rawItems option', async () => {
            await shelvesController.processCatalogLookup(req, res);

            expect(mockPipelineInstance.processImage).toHaveBeenCalledWith(
                null,
                expect.objectContaining({ id: 10, type: 'book' }),
                1,
                null,
                expect.objectContaining({
                    rawItems: expect.any(Array),
                    ocrProvider: 'mlkit',
                })
            );
        });

        it('should normalize name -> title and set kind from shelf type with confidence 1.0', async () => {
            await shelvesController.processCatalogLookup(req, res);

            const callArgs = mockPipelineInstance.processImage.mock.calls[0];
            const passedOptions = callArgs[4];
            expect(passedOptions.rawItems).toEqual([
                { title: 'Dune', author: 'Frank Herbert', kind: 'book', confidence: 1.0 },
                { title: 'Foundation', author: 'Isaac Asimov', kind: 'book', confidence: 1.0 },
            ]);
        });

        it('should return completion counts, summary, analysis, and hydrated items', async () => {
            mockPipelineInstance.processImage.mockResolvedValue({
                analysis: { shelfConfirmed: true },
                addedItems: [{ id: 1 }, { id: 2 }],
                needsReview: [{ id: 3 }],
            });

            await shelvesController.processCatalogLookup(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                addedCount: 2,
                needsReviewCount: 1,
                existingCount: 0,
                extractedCount: 0,
                summaryMessage: expect.any(String),
                analysis: { shelfConfirmed: true },
                items: expect.any(Array),
            }));
        });

        it('should return a duplicate-aware summary when items already exist on shelf', async () => {
            mockPipelineInstance.processImage.mockResolvedValue({
                analysis: { shelfConfirmed: true, items: [{ id: 'a' }, { id: 'b' }] },
                results: { added: 0, existing: 2, needsReview: 0, extracted: 2 },
                addedItems: [],
                needsReview: [],
            });

            await shelvesController.processCatalogLookup(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                addedCount: 0,
                existingCount: 2,
                extractedCount: 2,
                needsReviewCount: 0,
                summaryMessage: 'Scan complete: no new items added; 2 items already on this shelf.',
                items: expect.any(Array),
            }));
        });

        it('should handle pipeline result with no addedItems or needsReview gracefully', async () => {
            mockPipelineInstance.processImage.mockResolvedValue({
                analysis: null,
                addedItems: undefined,
                needsReview: undefined,
            });

            await shelvesController.processCatalogLookup(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                addedCount: 0,
                needsReviewCount: 0,
            }));
        });

        it('should return 500 if pipeline throws', async () => {
            mockPipelineInstance.processImage.mockRejectedValue(new Error('pipeline error'));
            await shelvesController.processCatalogLookup(req, res);
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: 'Catalog lookup failed' });
        });

        it('should use title field if name is absent', async () => {
            req.body = {
                items: [{ title: 'Neuromancer', author: 'William Gibson', type: 'book' }],
            };

            await shelvesController.processCatalogLookup(req, res);

            const callArgs = mockPipelineInstance.processImage.mock.calls[0];
            const passedOptions = callArgs[4];
            expect(passedOptions.rawItems[0].title).toBe('Neuromancer');
        });
    });

    describe('owner photo thumbnails', () => {
        it('returns owner-photo thumbnail bytes for authorized viewers', async () => {
            req.params = { shelfId: '10', itemId: '55' };
            const thumbBuffer = Buffer.from('thumb');
            userCollectionPhotosQueries.getByCollectionItem.mockResolvedValue({
                id: 55,
                userId: 1,
                shelfId: 10,
                ownerPhotoSource: 'upload',
                ownerPhotoVisible: false,
                showPersonalPhotos: false,
                ownerPhotoThumbContentType: 'image/jpeg',
            });
            userCollectionPhotosQueries.loadOwnerPhotoThumbnailBuffer.mockResolvedValue({
                buffer: thumbBuffer,
                contentType: 'image/jpeg',
                contentLength: thumbBuffer.length,
            });

            await shelvesController.getShelfItemOwnerPhotoThumbnail(req, res);

            expect(userCollectionPhotosQueries.loadOwnerPhotoThumbnailBuffer).toHaveBeenCalled();
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
            expect(res.send).toHaveBeenCalledWith(thumbBuffer);
        });

        it('rejects thumbnail update when box is missing', async () => {
            req.params = { shelfId: '10', itemId: '55' };
            req.body = {};

            await shelvesController.updateShelfItemOwnerPhotoThumbnail(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'box is required' });
        });

        it('updates thumbnail metadata with provided box', async () => {
            req.params = { shelfId: '10', itemId: '55' };
            req.body = { box: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } };
            userCollectionPhotosQueries.getByCollectionItem.mockResolvedValue({
                id: 55,
                userId: 1,
                shelfId: 10,
                ownerPhotoSource: 'upload',
                ownerPhotoVisible: true,
                showPersonalPhotos: true,
                ownerPhotoThumbContentType: 'image/jpeg',
                ownerPhotoThumbWidth: 300,
                ownerPhotoThumbHeight: 400,
                ownerPhotoThumbBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
                ownerPhotoThumbUpdatedAt: '2026-03-23T17:00:00.000Z',
                ownerPhotoUpdatedAt: '2026-03-23T16:00:00.000Z',
            });

            await shelvesController.updateShelfItemOwnerPhotoThumbnail(req, res);

            expect(userCollectionPhotosQueries.upsertOwnerPhotoThumbnailForItem).toHaveBeenCalledWith({
                itemId: 55,
                userId: 1,
                shelfId: 10,
                box: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
            });
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                ownerPhoto: expect.objectContaining({
                    thumbnailImageUrl: '/api/shelves/10/items/55/owner-photo/thumbnail',
                    thumbnailBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
                }),
            }));
        });
    });

    describe('completeReviewItem', () => {
        it('reuses fuzzy-review manual match for other shelves instead of creating duplicate manual rows', async () => {
            req.params = { shelfId: '10', id: '55' };
            req.body = {};
            shelvesQueries.getById.mockResolvedValue({ id: 10, type: 'other' });
            needsReviewQueries.getById.mockResolvedValue({
                id: 55,
                shelfId: 10,
                rawData: {
                    title: 'Weller Twelve',
                    author: 'Buffalo Trace Distillery',
                },
            });
            shelvesQueries.findManualByFingerprint.mockResolvedValue(null);
            shelvesQueries.findManualByBarcode.mockResolvedValue(null);
            shelvesQueries.fuzzyFindManualForOther.mockResolvedValue({
                id: 701,
                name: 'Weller 12',
                author: 'Buffalo Trace',
                titleSim: 0.86,
                creatorSim: 0.84,
                combinedSim: 0.85,
            });
            shelvesQueries.findManualCollection.mockResolvedValue({
                id: 999,
                position: null,
                format: null,
                notes: null,
                rating: null,
            });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 999,
                userId: 1,
                shelfId: 10,
                manualId: 701,
                position: null,
                format: null,
                platformMissing: false,
                notes: null,
                rating: null,
                isVisionLinked: false,
                ownedPlatforms: [],
                manualName: 'Weller 12',
                manualAuthor: 'Buffalo Trace',
                manualType: 'other',
                manualCoverMediaPath: null,
                manualYear: null,
                manualTags: [],
                manualGenre: [],
            });

            await shelvesController.completeReviewItem(req, res);

            expect(shelvesQueries.addManual).not.toHaveBeenCalled();
            expect(needsReviewQueries.markCompleted).toHaveBeenCalledWith(55, 1);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                item: expect.objectContaining({
                    id: 999,
                    manual: expect.objectContaining({ id: 701 }),
                }),
            }));
        });

        it('logs normalized collectable review payload when review completion creates shelf item', async () => {
            req.params = { shelfId: '10', id: '55' };
            req.body = {};
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'books', visibility: 'public' });
            needsReviewQueries.getById.mockResolvedValue({
                id: 55,
                shelfId: 10,
                rawData: { title: 'Review Title', primaryCreator: 'Review Creator' },
            });
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
            if (collectablesQueries.fuzzyMatch) {
                collectablesQueries.fuzzyMatch.mockResolvedValue({
                    id: 801,
                    title: 'Review Title',
                    primaryCreator: 'Review Creator',
                    year: 2011,
                    kind: 'books',
                    coverUrl: 'https://img.example/review.jpg',
                });
            }
            shelvesQueries.addCollectable.mockResolvedValue({
                id: 901,
                position: null,
                notes: null,
                rating: null,
            });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 901,
                userId: 1,
                shelfId: 10,
                collectableId: 801,
                position: null,
                format: null,
                platformMissing: false,
                notes: null,
                rating: null,
                isVisionLinked: false,
                ownedPlatforms: [],
                collectableTitle: 'Review Title',
                collectableCreator: 'Review Creator',
                collectableYear: 2011,
                collectableKind: 'books',
                collectableCover: 'https://img.example/review.jpg',
                collectableCoverImageUrl: null,
                collectableCoverImageSource: null,
            });

            await shelvesController.completeReviewItem(req, res);

            expect(feedQueries.logEvent).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'item.collectable_added',
                payload: expect.objectContaining({
                    source: 'review',
                    reviewItemId: 55,
                    itemId: 901,
                    collectableId: 801,
                    title: 'Review Title',
                    creator: 'Review Creator',
                    year: 2011,
                }),
            }));
        });

        it('logs normalized manual review payload for other-shelf review completion', async () => {
            req.params = { shelfId: '10', id: '55' };
            req.body = {};
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'other', visibility: 'public' });
            needsReviewQueries.getById.mockResolvedValue({
                id: 55,
                shelfId: 10,
                rawData: {
                    title: 'Manual Review',
                    author: 'Manual Review Creator',
                },
            });
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
            shelvesQueries.findManualByFingerprint.mockResolvedValue(null);
            shelvesQueries.findManualByBarcode.mockResolvedValue(null);
            shelvesQueries.fuzzyFindManualForOther.mockResolvedValue(null);
            shelvesQueries.addManual.mockResolvedValue({
                collection: {
                    id: 1201,
                    position: null,
                    format: null,
                    notes: null,
                    rating: null,
                },
                manual: {
                    id: 1301,
                    name: 'Manual Review',
                    author: 'Manual Review Creator',
                    year: 2020,
                    type: 'other',
                    coverMediaPath: 'manuals/1301.jpg',
                },
            });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 1201,
                userId: 1,
                shelfId: 10,
                manualId: 1301,
                position: null,
                format: null,
                platformMissing: false,
                notes: null,
                rating: null,
                isVisionLinked: false,
                ownedPlatforms: [],
                manualName: 'Manual Review',
                manualAuthor: 'Manual Review Creator',
                manualType: 'other',
                manualCoverMediaPath: 'manuals/1301.jpg',
                manualYear: 2020,
                manualTags: [],
                manualGenre: [],
            });

            await shelvesController.completeReviewItem(req, res);

            expect(feedQueries.logEvent).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'item.manual_added',
                payload: expect.objectContaining({
                    source: 'review',
                    reviewItemId: 55,
                    itemId: 1201,
                    manualId: 1301,
                    title: 'Manual Review',
                    creator: 'Manual Review Creator',
                    year: 2020,
                    coverMediaPath: 'manuals/1301.jpg',
                }),
            }));
        });

        it('preserves supported other-manual metadata when completing a review item', async () => {
            req.params = { shelfId: '10', id: '55' };
            req.body = {};
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'other', visibility: 'public' });
            needsReviewQueries.getById.mockResolvedValue({
                id: 55,
                shelfId: 10,
                rawData: {
                    title: 'Metadata Bottle',
                    author: 'Review Creator',
                    publisher: 'Shelf Publisher',
                    format: 'Bottle',
                    year: '2024',
                    marketValue: 'USD $250',
                    marketValueSources: [{ url: 'https://example.com/value', label: 'Value Source' }],
                    ageStatement: '12 years',
                    specialMarkings: 'Store Pick',
                    labelColor: 'Blue',
                    regionalItem: 'Kentucky',
                    edition: 'Batch 3',
                    barcode: '123456789012',
                    limitedEdition: '120/500',
                    itemSpecificText: 'Warehouse C',
                    tags: ['bourbon'],
                    genre: ['whiskey'],
                },
            });
            shelvesQueries.findManualByFingerprint.mockResolvedValue(null);
            shelvesQueries.findManualByBarcode.mockResolvedValue(null);
            shelvesQueries.fuzzyFindManualForOther.mockResolvedValue(null);
            shelvesQueries.addManual.mockResolvedValue({
                collection: {
                    id: 1203,
                    position: null,
                    format: null,
                    notes: null,
                    rating: null,
                },
                manual: {
                    id: 1303,
                    name: 'Metadata Bottle',
                    author: 'Review Creator',
                    type: 'other',
                },
            });

            await shelvesController.completeReviewItem(req, res);

            expect(shelvesQueries.addManual).toHaveBeenCalledWith(expect.objectContaining({
                userId: 1,
                shelfId: 10,
                name: 'Metadata Bottle',
                author: 'Review Creator',
                publisher: 'Shelf Publisher',
                format: 'Bottle',
                year: '2024',
                marketValue: 'USD $250',
                marketValueSources: [{ url: 'https://example.com/value', label: 'Value Source' }],
                ageStatement: '12 years',
                specialMarkings: 'Store Pick',
                labelColor: 'Blue',
                regionalItem: 'Kentucky',
                edition: 'Batch 3',
                barcode: '123456789012',
                limitedEdition: '120/500',
                itemSpecificText: 'Warehouse C',
                tags: expect.arrayContaining(['bourbon', 'whiskey']),
            }));
        });

        it('allows title-only other review completion and restores region/crop linkage', async () => {
            req.params = { shelfId: '10', id: '55' };
            req.body = {};
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'other', visibility: 'public' });
            needsReviewQueries.getById.mockResolvedValue({
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
            });
            shelvesQueries.findManualByBarcode.mockResolvedValue(null);
            shelvesQueries.addManual.mockResolvedValue({
                collection: {
                    id: 1201,
                    position: null,
                    format: null,
                    notes: null,
                    rating: null,
                },
                manual: {
                    id: 1301,
                    name: 'Mystery Bottle',
                    author: null,
                    type: 'other',
                },
            });
            visionScanPhotosQueries.getByIdForUser.mockResolvedValue({
                id: 77,
                width: 1000,
                height: 1000,
            });
            visionItemRegionsQueries.getByExtractionIndexForScan.mockResolvedValue({
                id: 880,
                scanPhotoId: 77,
                extractionIndex: 4,
            });
            if (shelvesQueries.getCollectionItemByIdForShelf) {
                shelvesQueries.getCollectionItemByIdForShelf.mockResolvedValue({ id: 1201, userId: 1 });
            }
            visionItemCropsQueries.getByRegionIdForUser.mockResolvedValue({
                id: 990,
                contentType: 'image/jpeg',
                sizeBytes: 123,
                width: 40,
                height: 60,
            });
            visionItemCropsQueries.loadImageBuffer.mockResolvedValue({
                buffer: Buffer.from('crop'),
                contentType: 'image/jpeg',
            });
            userCollectionPhotosQueries.attachVisionCropToItem.mockResolvedValue({
                ownerPhotoSource: 'vision_crop',
                ownerPhotoVisible: true,
            });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 1201,
                userId: 1,
                shelfId: 10,
                manualId: 1301,
                position: null,
                format: null,
                platformMissing: false,
                notes: null,
                rating: null,
                isVisionLinked: true,
                ownerPhotoSource: 'vision_crop',
                ownerPhotoVisible: true,
                ownerPhotoContentType: 'image/jpeg',
                ownerPhotoSizeBytes: 123,
                ownerPhotoWidth: 40,
                ownerPhotoHeight: 60,
                ownerPhotoThumbContentType: 'image/jpeg',
                ownerPhotoThumbSizeBytes: 44,
                ownerPhotoThumbWidth: 30,
                ownerPhotoThumbHeight: 45,
                ownerPhotoThumbBox: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 },
                ownerPhotoThumbUpdatedAt: '2026-04-01T12:00:00.000Z',
                ownerPhotoUpdatedAt: '2026-04-01T12:00:00.000Z',
                ownedPlatforms: [],
                manualName: 'Mystery Bottle',
                manualAuthor: null,
                manualType: 'other',
                manualCoverMediaPath: 'manuals/1301.jpg',
                manualDescription: null,
                manualYear: null,
                manualMarketValue: null,
                manualAgeStatement: null,
                manualSpecialMarkings: null,
                manualLabelColor: null,
                manualRegionalItem: null,
                manualEdition: null,
                manualBarcode: null,
                manualFingerprint: null,
                manualLimitedEdition: null,
                manualItemSpecificText: null,
                manualTags: [],
                manualGenre: [],
            });
            query
                .mockResolvedValueOnce({ rows: [{ cover_media_path: null }], rowCount: 1 });

            await shelvesController.completeReviewItem(req, res);

            expect(collectablesQueries.findByLightweightFingerprint).not.toHaveBeenCalled();
            expect(shelvesQueries.findManualByFingerprint).not.toHaveBeenCalled();
            expect(shelvesQueries.fuzzyFindManualForOther).not.toHaveBeenCalled();
            expect(visionItemRegionsQueries.getByExtractionIndexForScan).toHaveBeenCalledWith({
                userId: 1,
                shelfId: 10,
                scanPhotoId: 77,
                extractionIndex: 4,
            });
            expect(visionItemRegionsQueries.linkManual).toHaveBeenCalledWith({
                scanPhotoId: 77,
                extractionIndex: 4,
                manualId: 1301,
            });
            expect(visionItemRegionsQueries.linkCollectionItem).toHaveBeenCalledWith({
                scanPhotoId: 77,
                extractionIndex: 4,
                collectionItemId: 1201,
            });
            expect(userCollectionPhotosQueries.attachVisionCropToItem).toHaveBeenCalledWith(expect.objectContaining({
                itemId: 1201,
                cropId: 990,
            }));
            expect(manualMediaQueries.uploadFromBuffer).toHaveBeenCalledWith(expect.objectContaining({
                userId: 1,
                manualId: 1301,
            }));
            expect(needsReviewQueries.markCompleted).toHaveBeenCalledWith(55, 1);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                item: expect.objectContaining({
                    id: 1201,
                    ownerPhoto: expect.objectContaining({
                        source: 'vision_crop',
                        imageUrl: '/api/shelves/10/items/1201/owner-photo/image',
                        thumbnailImageUrl: '/api/shelves/10/items/1201/owner-photo/thumbnail',
                    }),
                    manual: expect.objectContaining({
                        id: 1301,
                        author: null,
                        coverMediaPath: 'manuals/1301.jpg',
                    }),
                }),
            }));
        });

        it('keeps legacy review rows without reviewContext backward compatible', async () => {
            req.params = { shelfId: '10', id: '55' };
            req.body = {};
            shelvesQueries.getById.mockResolvedValue({ id: 10, ownerId: 1, type: 'other', visibility: 'public' });
            needsReviewQueries.getById.mockResolvedValue({
                id: 55,
                shelfId: 10,
                rawData: {
                    title: 'Legacy Manual Review',
                    author: 'Legacy Creator',
                },
            });
            shelvesQueries.findManualByFingerprint.mockResolvedValue(null);
            shelvesQueries.findManualByBarcode.mockResolvedValue(null);
            shelvesQueries.fuzzyFindManualForOther.mockResolvedValue(null);
            shelvesQueries.addManual.mockResolvedValue({
                collection: {
                    id: 1202,
                    position: null,
                    format: null,
                    notes: null,
                    rating: null,
                },
                manual: {
                    id: 1302,
                    name: 'Legacy Manual Review',
                    author: 'Legacy Creator',
                    type: 'other',
                },
            });
            shelvesQueries.getItemById.mockResolvedValue({
                id: 1202,
                userId: 1,
                shelfId: 10,
                manualId: 1302,
                position: null,
                format: null,
                platformMissing: false,
                notes: null,
                rating: null,
                isVisionLinked: false,
                ownedPlatforms: [],
                manualName: 'Legacy Manual Review',
                manualAuthor: 'Legacy Creator',
                manualType: 'other',
                manualCoverMediaPath: null,
                manualYear: null,
                manualTags: [],
                manualGenre: [],
            });

            await shelvesController.completeReviewItem(req, res);

            expect(visionScanPhotosQueries.getByIdForUser).not.toHaveBeenCalled();
            expect(visionItemRegionsQueries.getByExtractionIndexForScan).not.toHaveBeenCalled();
            expect(needsReviewQueries.markCompleted).toHaveBeenCalledWith(55, 1);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                item: expect.objectContaining({
                    id: 1202,
                    manual: expect.objectContaining({ id: 1302 }),
                }),
            }));
        });
    });

    describe('getManualItem', () => {
        beforeEach(() => {
            req.params = { manualId: '901' };
            req.user = { id: 'friend-2' };
        });

        it('denies access when viewer cannot access source shelf', async () => {
            shelvesQueries.getManualById.mockResolvedValue({
                id: 901,
                shelfId: 10,
                coverMediaPath: 'manuals/901.jpg',
            });
            shelvesQueries.getForViewing.mockResolvedValue(null);

            await shelvesController.getManualItem(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Viewer does not have access' });
        });

        it('redacts manual cover media for authorized non-owner viewer when sharing is off', async () => {
            shelvesQueries.getManualById.mockResolvedValue({
                id: 901,
                shelfId: 10,
                coverMediaPath: 'manuals/901.jpg',
            });
            shelvesQueries.getForViewing.mockResolvedValue({
                id: 10,
                ownerId: 'owner-1',
                type: 'other',
                visibility: 'public',
            });
            query.mockResolvedValueOnce({
                rows: [{
                    owner_id: 'owner-1',
                    shelf_type: 'other',
                    owner_photo_source: 'upload',
                    owner_photo_visible: true,
                    show_personal_photos: false,
                }],
            });

            await shelvesController.getManualItem(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                manual: expect.objectContaining({
                    id: 901,
                    coverMediaPath: null,
                    coverMediaUrl: null,
                }),
            }));
        });

        it('keeps manual cover media for authorized non-owner viewer when sharing is on', async () => {
            shelvesQueries.getManualById.mockResolvedValue({
                id: 901,
                shelfId: 10,
                coverMediaPath: 'manuals/901.jpg',
            });
            shelvesQueries.getForViewing.mockResolvedValue({
                id: 10,
                ownerId: 'owner-1',
                type: 'other',
                visibility: 'public',
            });
            query.mockResolvedValueOnce({
                rows: [{
                    owner_id: 'owner-1',
                    shelf_type: 'other',
                    owner_photo_source: 'vision_crop',
                    owner_photo_visible: true,
                    show_personal_photos: true,
                }],
            });

            await shelvesController.getManualItem(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                manual: expect.objectContaining({
                    id: 901,
                    coverMediaPath: 'manuals/901.jpg',
                    coverMediaUrl: expect.stringContaining('/manuals/901.jpg'),
                }),
            }));
        });
    });
});
