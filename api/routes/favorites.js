const express = require('express');
const { auth } = require('../middleware/auth');
const { validateUUID } = require('../middleware/validate');
const favoritesController = require('../controllers/favoritesController');

const router = express.Router();

// All routes require authentication
router.use(auth);

router.get('/', favoritesController.listFavorites);
router.post('/', favoritesController.addFavorite);

// User specific routes
router.get('/user/:userId', validateUUID(['userId']), favoritesController.listUserFavorites);
router.get('/user/:userId/check', validateUUID(['userId']), favoritesController.checkUserHasFavorites);

router.delete('/:collectableId', favoritesController.removeFavorite);
router.get('/:collectableId/check', favoritesController.checkFavorite);
router.post('/check-batch', favoritesController.checkFavoritesBatch);

module.exports = router;
