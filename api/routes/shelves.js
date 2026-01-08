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
router.post('/:shelfId/manual', requireFields(['name']), ctrl.addManualEntry);
router.post('/:shelfId/items', requireFields(['collectableId']), ctrl.addCollectable);
router.delete('/:shelfId/items/:itemId', ctrl.removeShelfItem);
router.put('/:shelfId/manual/:itemId', ctrl.updateManualEntry);


router.get('/:shelfId/search', ctrl.searchCollectablesForShelf);
router.post('/:shelfId/vision', requireFields(['imageBase64']), ctrl.processShelfVision);
router.post('/:shelfId/catalog-lookup', ctrl.processCatalogLookup);


module.exports = router;



