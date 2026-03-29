const express = require('express');
const multer = require('multer');
const { auth } = require('../middleware/auth');
const { requireFields, validateIntParam, validateStringLengths } = require('../middleware/validate');
const { createWorkflowJobContext } = require('../middleware/workflowJobContext');
const ctrl = require('../controllers/shelvesController');
const { isAllowedImageMimeType } = require('../utils/imageValidation');

const router = express.Router();

// Configure multer for cover image uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (isAllowedImageMimeType(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG, PNG, and WEBP images are allowed'));
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

router.get('/:shelfId/items', shelfIntParam, ctrl.listShelfItems);
router.post('/:shelfId/manual/search', shelfIntParam, ctrl.searchManualEntry);
router.post('/:shelfId/manual', shelfIntParam, requireFields(['name']), validateStringLengths({ name: 500, description: 5000 }), ctrl.addManualEntry);
router.post('/:shelfId/items', shelfIntParam, ctrl.addCollectable);
router.post('/:shelfId/items/from-api', shelfIntParam, ctrl.addCollectableFromApi);
router.post('/:shelfId/items/:itemId/replacement-intent', shelfItemIntParams, ctrl.createReplacementIntent);
router.post('/:shelfId/items/:itemId/replace', shelfItemIntParams, ctrl.replaceShelfItem);
router.delete('/:shelfId/items/:itemId', shelfItemIntParams, ctrl.removeShelfItem);
router.put('/:shelfId/items/:itemId/rating', shelfItemIntParams, ctrl.rateShelfItem);
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
router.post('/:shelfId/vision', shelfIntParam, visionWorkflowContext, requireVisionPayload, ctrl.processShelfVision);
router.get('/:shelfId/vision/scans/:scanPhotoId', shelfVisionScanIntParams, ctrl.getVisionScanPhoto);
router.get('/:shelfId/vision/scans/:scanPhotoId/image', shelfVisionScanIntParams, ctrl.getVisionScanPhotoImage);
router.get('/:shelfId/vision/scans/:scanPhotoId/regions', shelfVisionScanIntParams, ctrl.listVisionScanRegions);
router.get('/:shelfId/vision/scans/:scanPhotoId/regions/:regionId/crop', shelfVisionRegionIntParams, ctrl.getVisionScanRegionCrop);
router.get('/:shelfId/vision/:jobId/status', shelfIntParam, ctrl.getVisionStatus);
router.delete('/:shelfId/vision/:jobId', shelfIntParam, ctrl.abortVision);
router.post('/:shelfId/catalog-lookup', shelfIntParam, catalogWorkflowContext, ctrl.processCatalogLookup);

// Review Queue
router.get('/:shelfId/review', shelfIntParam, ctrl.listReviewItems);
router.post('/:shelfId/review/:id/complete', shelfReviewIntParams, ctrl.completeReviewItem);
router.delete('/:shelfId/review/:id', shelfReviewIntParams, ctrl.dismissReviewItem);


module.exports = router;



