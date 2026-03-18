/**
 * Wishlists Routes
 */

const express = require('express');
const { auth } = require('../middleware/auth');
const { validateUUID, validateIntParam, validateStringLengths } = require('../middleware/validate');
const wishlistController = require('../controllers/wishlistController');

const router = express.Router();

// All routes require authentication
router.use(auth);

const wishlistIntParam = validateIntParam(['id']);
const wishlistItemIntParams = validateIntParam(['id', 'itemId']);
const wishlistStringLengths = validateStringLengths({ name: 500, description: 5000 });

router.get('/', wishlistController.listWishlists);
router.post('/', wishlistStringLengths, wishlistController.createWishlist);

// User-specific routes (must be before /:id routes)
router.get('/user/:userId', validateUUID(['userId']), wishlistController.listUserWishlists);
router.get('/user/:userId/check', validateUUID(['userId']), wishlistController.checkUserHasWishlists);

router.get('/:id', wishlistIntParam, wishlistController.getWishlist);
router.put('/:id', wishlistIntParam, wishlistStringLengths, wishlistController.updateWishlist);
router.delete('/:id', wishlistIntParam, wishlistController.deleteWishlist);
router.get('/:id/items', wishlistIntParam, wishlistController.listItems);
router.post('/:id/items', wishlistIntParam, wishlistController.addItem);
router.delete('/:id/items/:itemId', wishlistItemIntParams, wishlistController.removeItem);

module.exports = router;
