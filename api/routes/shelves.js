const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { auth } = require('../middleware/auth');
const { imageUploadErrorHandler } = require('../middleware/imageUploadErrorHandler');
const { requireFields, validateIntParam, validateStringLengths } = require('../middleware/validate');
const { createWorkflowJobContext } = require('../middleware/workflowJobContext');
const ctrl = require('../controllers/shelvesController');
const { isAllowedImageMimeType } = require('../utils/imageValidation');

const router = express.Router();

// Configure multer for cover image uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        if (isAllowedImageMimeType(file.mimetype)) {
            cb(null, true);
        } else {
            const error = new Error('Only JPEG, PNG, and WEBP images are allowed');
            error.status = 400;
            error.code = 'invalid_image_type';
            cb(error);
        }
    },
});

// All routes here require local JWT
router.use(auth);

const shelfIntParam = validateIntParam(['shelfId']);
const shelfItemIntParams = validateIntParam(['shelfId', 'itemId']);
const shelfItemOwnerPhotoIntParams = validateIntParam(['shelfId', 'itemId']);
const shelfReviewIntParams = validateIntParam(['shelfId', 'id']);
const shelfVisionScanIntParams = validateIntParam(['shelfId', 'scanPhotoId']);
const shelfVisionRegionIntParams = validateIntParam(['shelfId', 'scanPhotoId', 'regionId']);
const visionWorkflowContext = createWorkflowJobContext('vision');
const catalogWorkflowContext = createWorkflowJobContext('catalog_lookup');

const VISION_INGRESS_WINDOW_MS = Number.parseInt(process.env.VISION_INGRESS_WINDOW_MS || '60000', 10);
const VISION_INGRESS_MAX = Number.parseInt(process.env.VISION_INGRESS_MAX || '10', 10);
const CATALOG_INGRESS_WINDOW_MS = Number.parseInt(process.env.CATALOG_INGRESS_WINDOW_MS || '60000', 10);
const CATALOG_INGRESS_MAX = Number.parseInt(process.env.CATALOG_INGRESS_MAX || '20', 10);

function createWorkflowLimiter({ windowMs, max, message }) {
    return rateLimit({
        windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60000,
        max: Number.isFinite(max) && max > 0 ? max : 10,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id || req.ip,
        handler: (_req, res) => {
            res.status(429).json({
                error: message,
                code: 'workflow_ingress_rate_limited',
            });
        },
    });
}

const visionIngressLimiter = createWorkflowLimiter({
    windowMs: VISION_INGRESS_WINDOW_MS,
    max: VISION_INGRESS_MAX,
    message: 'Too many vision requests. Please wait and try again.',
});
const catalogIngressLimiter = createWorkflowLimiter({
    windowMs: CATALOG_INGRESS_WINDOW_MS,
    max: CATALOG_INGRESS_MAX,
    message: 'Too many catalog lookup requests. Please wait and try again.',
});

function requireVisionPayload(req, res, next) {
    const { imageBase64, rawItems } = req.body ?? {};
    if (imageBase64 || (Array.isArray(rawItems) && rawItems.length > 0)) {
        return next();
    }
    return res.status(400).json({ error: 'imageBase64 or rawItems are required' });
}

router.get('/', ctrl.listShelves);
router.post('/', requireFields(['name', 'type']), validateStringLengths({ name: 500, description: 5000 }), ctrl.createShelf);

// Note: Must come before /:shelfId
router.get('/search', validateStringLengths({ q: 500 }, { source: 'query' }), ctrl.searchUserCollection);

router.get('/:shelfId', shelfIntParam, ctrl.getShelf);
router.put('/:shelfId', shelfIntParam, validateStringLengths({ name: 500, description: 5000 }), ctrl.updateShelf);
router.delete('/:shelfId', shelfIntParam, ctrl.deleteShelf);
router.get('/:shelfId/photo', shelfIntParam, ctrl.getShelfPhoto);
router.get('/:shelfId/photo/image', shelfIntParam, ctrl.getShelfPhotoImage);
router.post('/:shelfId/photo', shelfIntParam, upload.single('photo'), ctrl.uploadShelfPhoto);
router.delete('/:shelfId/photo', shelfIntParam, ctrl.deleteShelfPhoto);

router.get('/:shelfId/items', shelfIntParam, ctrl.listShelfItems);
router.post('/:shelfId/manual/search', shelfIntParam, ctrl.searchManualEntry);
router.post('/:shelfId/manual', shelfIntParam, requireFields(['name']), validateStringLengths({ name: 500, description: 5000 }), ctrl.addManualEntry);
router.post('/:shelfId/items', shelfIntParam, ctrl.addCollectable);
router.post('/:shelfId/items/from-api', shelfIntParam, ctrl.addCollectableFromApi);
router.post('/:shelfId/items/:itemId/replacement-intent', shelfItemIntParams, ctrl.createReplacementIntent);
router.post('/:shelfId/items/:itemId/replace', shelfItemIntParams, ctrl.replaceShelfItem);
router.delete('/:shelfId/items/:itemId', shelfItemIntParams, ctrl.removeShelfItem);
router.put('/:shelfId/items/:itemId/rating', shelfItemIntParams, ctrl.rateShelfItem);
router.put('/:shelfId/items/:itemId/platforms', shelfItemIntParams, ctrl.updateOwnedPlatforms);
router.put('/:shelfId/manual/:itemId', shelfItemIntParams, validateStringLengths({ name: 500, description: 5000 }), ctrl.updateManualEntry);
router.post('/:shelfId/manual/:itemId/cover', shelfItemIntParams, upload.single('cover'), ctrl.uploadManualCover);
router.get('/:shelfId/items/:itemId/owner-photo', shelfItemOwnerPhotoIntParams, ctrl.getShelfItemOwnerPhoto);
router.get('/:shelfId/items/:itemId/owner-photo/image', shelfItemOwnerPhotoIntParams, ctrl.getShelfItemOwnerPhotoImage);
router.get('/:shelfId/items/:itemId/owner-photo/thumbnail', shelfItemOwnerPhotoIntParams, ctrl.getShelfItemOwnerPhotoThumbnail);
router.put('/:shelfId/items/:itemId/owner-photo/thumbnail', shelfItemOwnerPhotoIntParams, ctrl.updateShelfItemOwnerPhotoThumbnail);
router.put('/:shelfId/items/:itemId/owner-photo/visibility', shelfItemOwnerPhotoIntParams, ctrl.updateShelfItemOwnerPhotoVisibility);
router.post('/:shelfId/items/:itemId/owner-photo', shelfItemOwnerPhotoIntParams, upload.single('photo'), ctrl.uploadShelfItemOwnerPhoto);
router.delete('/:shelfId/items/:itemId/owner-photo', shelfItemOwnerPhotoIntParams, ctrl.deleteShelfItemOwnerPhoto);

router.get('/:shelfId/search', shelfIntParam, ctrl.searchCollectablesForShelf);
router.post('/:shelfId/vision', shelfIntParam, visionIngressLimiter, visionWorkflowContext, requireVisionPayload, ctrl.processShelfVision);
router.get('/:shelfId/vision/scans/:scanPhotoId', shelfVisionScanIntParams, ctrl.getVisionScanPhoto);
router.get('/:shelfId/vision/scans/:scanPhotoId/image', shelfVisionScanIntParams, ctrl.getVisionScanPhotoImage);
router.get('/:shelfId/vision/scans/:scanPhotoId/regions', shelfVisionScanIntParams, ctrl.listVisionScanRegions);
router.get('/:shelfId/vision/scans/:scanPhotoId/regions/:regionId/crop', shelfVisionRegionIntParams, ctrl.getVisionScanRegionCrop);
router.get('/:shelfId/vision/:jobId/status', shelfIntParam, ctrl.getVisionStatus);
router.post('/:shelfId/vision/:jobId/background', shelfIntParam, ctrl.setVisionBackground);
router.delete('/:shelfId/vision/:jobId', shelfIntParam, ctrl.abortVision);
router.post('/:shelfId/catalog-lookup', shelfIntParam, catalogIngressLimiter, catalogWorkflowContext, ctrl.processCatalogLookup);

// Review Queue
router.get('/:shelfId/review', shelfIntParam, ctrl.listReviewItems);
router.post('/:shelfId/review/:id/complete', shelfReviewIntParams, ctrl.completeReviewItem);
router.delete('/:shelfId/review/:id', shelfReviewIntParams, ctrl.dismissReviewItem);

router.use(imageUploadErrorHandler);

module.exports = router;
