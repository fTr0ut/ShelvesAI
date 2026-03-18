const express = require('express');
const { auth } = require('../middleware/auth');
const { validateIntParam, validateStringLengths } = require('../middleware/validate');
const listsController = require('../controllers/listsController');

const router = express.Router();

// All routes require authentication
router.use(auth);

const listIntParam = validateIntParam(['id']);
const listItemIntParams = validateIntParam(['id', 'itemId']);
const listStringLengths = validateStringLengths({ name: 500, description: 5000 });

// List management
router.get('/', listsController.listLists);
router.post('/', listStringLengths, listsController.createList);
router.get('/:id', listIntParam, listsController.getList);
router.put('/:id', listIntParam, listStringLengths, listsController.updateList);
router.delete('/:id', listIntParam, listsController.deleteList);

// List item management
router.post('/:id/items', listIntParam, listsController.addListItem);
router.delete('/:id/items/:itemId', listItemIntParams, listsController.removeListItem);
router.put('/:id/reorder', listIntParam, listsController.reorderListItems);

module.exports = router;
