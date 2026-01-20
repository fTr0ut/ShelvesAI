const express = require('express');
const { auth } = require('../middleware/auth');
const ctrl = require('../controllers/ratingsController');

const router = express.Router();

// All routes require authentication
router.use(auth);

// GET/PUT /api/ratings/:itemId - get/set rating for item
// Use query param ?type=manual for manual items
router.get('/:itemId', ctrl.getRating);
router.put('/:itemId', ctrl.setRating);

// GET /api/ratings/:collectableId/aggregate - aggregate rating for collectables only
router.get('/:collectableId/aggregate', ctrl.getAggregateRating);

// GET /api/ratings/:itemId/user/:userId - get another user's rating for item
router.get('/:itemId/user/:userId', ctrl.getUserRating);

module.exports = router;
