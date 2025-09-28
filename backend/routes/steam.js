const express = require('express');
const { auth } = require('../middleware/auth');
const steam = require('../controllers/steamController');

const router = express.Router();

router.use(auth);

router.get('/status', steam.getStatus);
router.post('/link/start', steam.startLink);
router.post('/link/complete', steam.completeLink);
router.delete('/link', steam.unlinkAccount);
router.post('/library/import', steam.importLibrary);

module.exports = router;