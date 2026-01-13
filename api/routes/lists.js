const express = require('express');
const { auth } = require('../middleware/auth');
const listsController = require('../controllers/listsController');

const router = express.Router();

// All routes require authentication
router.use(auth);

// List management
router.get('/', listsController.listLists);
router.post('/', listsController.createList);
router.get('/:id', listsController.getList);
router.put('/:id', listsController.updateList);
router.delete('/:id', listsController.deleteList);

// List item management
router.post('/:id/items', listsController.addListItem);
router.delete('/:id/items/:itemId', listsController.removeListItem);
router.put('/:id/reorder', listsController.reorderListItems);

module.exports = router;
