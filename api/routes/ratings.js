const express = require('express');
const { auth } = require('../middleware/auth');
const ctrl = require('../controllers/ratingsController');

const router = express.Router();

// Public/Shared routes (still require auth for context usually, but could be open)
// For now, we'll require auth for everything consistent with the app
router.use(auth);

router.get('/:collectableId', ctrl.getRating);
router.put('/:collectableId', ctrl.setRating);
router.get('/:collectableId/aggregate', ctrl.getAggregateRating);
router.get('/:collectableId/user/:userId', ctrl.getUserRating);

module.exports = router;
