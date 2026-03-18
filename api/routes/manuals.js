const express = require('express');
const { auth } = require('../middleware/auth');
const { validateIntParam } = require('../middleware/validate');
const ctrl = require('../controllers/shelvesController');

const router = express.Router();

// All routes require authentication
router.use(auth);

// GET /api/manuals/:manualId - Get manual item details
router.get('/:manualId', validateIntParam(['manualId']), ctrl.getManualItem);

module.exports = router;
