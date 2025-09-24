const express = require('express');
const { auth } = require('../middleware/auth');
const { getFeed, getFeedEntryDetails } = require('../controllers/feedController');

const router = express.Router();

router.use(auth);
router.get('/', getFeed);
router.get('/:shelfId', getFeedEntryDetails);

module.exports = router;

