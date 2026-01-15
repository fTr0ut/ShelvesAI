/**
 * Wishlists Routes
 */

const express = require('express');
const { auth } = require('../middleware/auth');
const wishlistController = require('../controllers/wishlistController');

const router = express.Router();

// All routes require authentication
router.use(auth);

router.get('/', wishlistController.listWishlists);
router.post('/', wishlistController.createWishlist);

// User-specific routes (must be before /:id routes)
router.get('/user/:userId', wishlistController.listUserWishlists);
router.get('/user/:userId/check', wishlistController.checkUserHasWishlists);

router.get('/:id', wishlistController.getWishlist);
router.put('/:id', wishlistController.updateWishlist);
router.delete('/:id', wishlistController.deleteWishlist);
router.get('/:id/items', wishlistController.listItems);
router.post('/:id/items', wishlistController.addItem);
router.delete('/:id/items/:itemId', wishlistController.removeItem);

module.exports = router;
