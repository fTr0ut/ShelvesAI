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
const shelfReviewIntParams = validateIntParam(['shelfId', 'id']);
const visionWorkflowContext = createWorkflowJobContext('vision');
const catalogWorkflowContext = createWorkflowJobContext('catalog_lookup');

router.get('/', ctrl.listShelves);
router.post('/', requireFields(['name', 'type']), validateStringLengths({ name: 500, description: 5000 }), ctrl.createShelf);

router.get('/:shelfId', shelfIntParam, ctrl.getShelf);
router.put('/:shelfId', shelfIntParam, validateStringLengths({ name: 500, description: 5000 }), ctrl.updateShelf);
router.delete('/:shelfId', shelfIntParam, ctrl.deleteShelf);

router.get('/:shelfId/items', shelfIntParam, ctrl.listShelfItems);
router.post('/:shelfId/manual/search', shelfIntParam, ctrl.searchManualEntry);
router.post('/:shelfId/manual', shelfIntParam, requireFields(['name']), validateStringLengths({ name: 500, description: 5000 }), ctrl.addManualEntry);
router.post('/:shelfId/items', shelfIntParam, requireFields(['collectableId']), ctrl.addCollectable);
router.post('/:shelfId/items/from-api', shelfIntParam, ctrl.addCollectableFromApi);
router.delete('/:shelfId/items/:itemId', shelfItemIntParams, ctrl.removeShelfItem);
router.put('/:shelfId/items/:itemId/rating', shelfItemIntParams, ctrl.rateShelfItem);
router.put('/:shelfId/manual/:itemId', shelfItemIntParams, validateStringLengths({ name: 500, description: 5000 }), ctrl.updateManualEntry);
router.post('/:shelfId/manual/:itemId/cover', shelfItemIntParams, upload.single('cover'), ctrl.uploadManualCover);

router.get('/:shelfId/search', shelfIntParam, ctrl.searchCollectablesForShelf);
router.post('/:shelfId/vision', shelfIntParam, visionWorkflowContext, requireFields(['imageBase64']), ctrl.processShelfVision);
router.get('/:shelfId/vision/:jobId/status', shelfIntParam, ctrl.getVisionStatus);
router.delete('/:shelfId/vision/:jobId', shelfIntParam, ctrl.abortVision);
router.post('/:shelfId/catalog-lookup', shelfIntParam, catalogWorkflowContext, ctrl.processCatalogLookup);

// Review Queue
router.get('/:shelfId/review', shelfIntParam, ctrl.listReviewItems);
router.post('/:shelfId/review/:id/complete', shelfReviewIntParams, ctrl.completeReviewItem);
router.delete('/:shelfId/review/:id', shelfReviewIntParams, ctrl.dismissReviewItem);


module.exports = router;



