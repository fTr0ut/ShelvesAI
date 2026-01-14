const express = require('express');
const { auth } = require('../middleware/auth');
const { requireFields } = require('../middleware/validate');
const ctrl = require('../controllers/shelvesController');

const router = express.Router();

// All routes here require local JWT
router.use(auth);

router.get('/', ctrl.listShelves);
router.post('/', requireFields(['name', 'type']), ctrl.createShelf);

router.get('/:shelfId', ctrl.getShelf);
router.put('/:shelfId', ctrl.updateShelf);

router.get('/:shelfId/items', ctrl.listShelfItems);
router.post('/:shelfId/manual/search', ctrl.searchManualEntry);
router.post('/:shelfId/manual', requireFields(['name']), ctrl.addManualEntry);
router.post('/:shelfId/items', requireFields(['collectableId']), ctrl.addCollectable);
router.delete('/:shelfId/items/:itemId', ctrl.removeShelfItem);
router.put('/:shelfId/items/:itemId/rating', ctrl.rateShelfItem);
router.put('/:shelfId/manual/:itemId', ctrl.updateManualEntry);


router.get('/:shelfId/search', ctrl.searchCollectablesForShelf);
router.post('/:shelfId/vision', requireFields(['imageBase64']), ctrl.processShelfVision);
router.get('/:shelfId/vision/:jobId/status', ctrl.getVisionStatus);
router.delete('/:shelfId/vision/:jobId', ctrl.abortVision);
router.post('/:shelfId/catalog-lookup', ctrl.processCatalogLookup);

// Review Queue
router.get('/:shelfId/review', ctrl.listReviewItems);
router.post('/:shelfId/review/:id/complete', ctrl.completeReviewItem);
router.delete('/:shelfId/review/:id', ctrl.dismissReviewItem);


module.exports = router;



