const shelvesController = require('../controllers/shelvesController');
const { VisionPipelineService } = require('../services/visionPipeline');
const shelvesQueries = require('../database/queries/shelves');
const visionResultCacheQueries = require('../database/queries/visionResultCache');
const visionScanPhotosQueries = require('../database/queries/visionScanPhotos');
const visionItemRegionsQueries = require('../database/queries/visionItemRegions');
const visionItemCropsQueries = require('../database/queries/visionItemCrops');
const workflowQueueJobsQueries = require('../database/queries/workflowQueueJobs');
const userCollectionPhotosQueries = require('../database/queries/userCollectionPhotos');
const manualMediaQueries = require('../database/queries/manualMedia');
const { extractRegionCrop } = require('../services/visionCropper');
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
}));
jest.mock('../database/queries/visionScanPhotos', () => ({
    upsertFromBuffer: jest.fn().mockResolvedValue({ id: 77 }),
    getByIdForUser: jest.fn().mockResolvedValue(null),
    loadImageBuffer: jest.fn(),
}));
jest.mock('../database/queries/visionItemRegions', () => ({
    countForScan: jest.fn().mockResolvedValue(0),
    listForScan: jest.fn().mockResolvedValue([]),
    getByIdForScan: jest.fn().mockResolvedValue(null),
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
jest.mock('../services/visionCropper', () => ({
    extractRegionCrop: jest.fn(),
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
        periodStart: new Date().toISOString(),
        daysRemaining: 30,
    }),
    incrementUsage: jest.fn().mockResolvedValue({ scansUsed: 1, scansRemaining: 49, monthlyLimit: 50 }),
}));

describe('shelvesController', () => {
    let req, res;
    let mockPipelineInstance;

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
        shelvesQueries.addManual.mockReset();
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
        itemReplacementTracesQueries.createIntent.mockReset();
        itemReplacementTracesQueries.getByIdForUser.mockReset();
        itemReplacementTracesQueries.markCompleted.mockReset();
        itemReplacementTracesQueries.markFailed.mockReset();
        visionResultCacheQueries.getValid.mockReset();
        visionResultCacheQueries.set.mockReset();
        visionScanPhotosQueries.upsertFromBuffer.mockReset();
        visionScanPhotosQueries.getByIdForUser.mockReset();
        visionScanPhotosQueries.loadImageBuffer.mockReset();
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
        manualMediaQueries.uploadFromBuffer.mockReset();
        needsReviewQueries.getById.mockReset();
        needsReviewQueries.markCompleted.mockReset();
        ratingsQueries.getRating.mockReset();
        feedQueries.upsertReviewedEvent.mockReset();

        // Mock loadShelfForUser via the query it calls? 
        // Controller calls loadShelfForUser which calls shelvesQueries.getById
        shelvesQueries.getById.mockResolvedValue({ id: 10, type: 'book' });
        shelvesQueries.getItems.mockResolvedValue([]);
        visionResultCacheQueries.getValid.mockResolvedValue(null);
        visionScanPhotosQueries.upsertFromBuffer.mockResolvedValue({ id: 77 });
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
        itemReplacementTracesQueries.createIntent.mockResolvedValue(null);
        itemReplacementTracesQueries.getByIdForUser.mockResolvedValue(null);
        itemReplacementTracesQueries.markCompleted.mockResolvedValue(null);
        itemReplacementTracesQueries.markFailed.mockResolvedValue(null);
        userCollectionPhotosQueries.getByCollectionItem.mockResolvedValue(null);
        userCollectionPhotosQueries.loadOwnerPhotoThumbnailBuffer.mockReset();
        userCollectionPhotosQueries.upsertOwnerPhotoThumbnailForItem.mockReset();
        userCollectionPhotosQueries.attachVisionCropToItem.mockResolvedValue(null);
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

            expect(extractRegionCrop).not.toHaveBeenCalled();
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
            expect(res.send).toHaveBeenCalledWith(cropBuffer);
        });

        it('generates and stores a crop lazily when none exists', async () => {
            const generatedCrop = Buffer.from('generated-crop');
            visionItemCropsQueries.getByRegionIdForUser.mockResolvedValue(null);
            visionScanPhotosQueries.loadImageBuffer.mockResolvedValue({
                buffer: Buffer.from('scan-photo'),
                contentType: 'image/jpeg',
                contentLength: 100,
            });
            extractRegionCrop.mockResolvedValue({
                buffer: generatedCrop,
                contentType: 'image/jpeg',
                width: 300,
                height: 400,
            });
            visionItemCropsQueries.upsertFromBuffer.mockResolvedValue({
                id: 902,
                regionId: 8,
                contentType: 'image/jpeg',
            });

            await shelvesController.getVisionScanRegionCrop(req, res);

            expect(extractRegionCrop).toHaveBeenCalledWith(expect.objectContaining({
                box2d: [100, 200, 700, 900],
                imageWidth: 1200,
                imageHeight: 800,
            }));
            expect(visionItemCropsQueries.upsertFromBuffer).toHaveBeenCalledWith(expect.objectContaining({
                userId: 1,
                shelfId: 10,
                scanPhotoId: 77,
                regionId: 8,
            }));
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
            expect(res.send).toHaveBeenCalledWith(generatedCrop);
        });

        it('accepts region box_2d payloads from persistence for crop extraction', async () => {
            const generatedCrop = Buffer.from('generated-crop');
            visionItemRegionsQueries.getByIdForScan.mockResolvedValue({
                id: 8,
                box_2d: [100, 200, 700, 900],
            });
            visionItemCropsQueries.getByRegionIdForUser.mockResolvedValue(null);
            visionScanPhotosQueries.loadImageBuffer.mockResolvedValue({
                buffer: Buffer.from('scan-photo'),
                contentType: 'image/jpeg',
                contentLength: 100,
            });
            extractRegionCrop.mockResolvedValue({
                buffer: generatedCrop,
                contentType: 'image/jpeg',
                width: 300,
                height: 400,
            });

            await shelvesController.getVisionScanRegionCrop(req, res);

            expect(extractRegionCrop).toHaveBeenCalledWith(expect.objectContaining({
                box2d: [100, 200, 700, 900],
                imageWidth: 1200,
                imageHeight: 800,
            }));
            expect(res.send).toHaveBeenCalledWith(generatedCrop);
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
