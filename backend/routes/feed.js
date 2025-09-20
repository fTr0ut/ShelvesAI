const express = require('express');
const { auth } = require('../middleware/auth');
const { getFeed } = require('../controllers/feedController');

const router = express.Router();

router.use(auth);
router.get('/', getFeed);

module.exports = router;

