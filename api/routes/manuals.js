const express = require('express');
const { auth } = require('../middleware/auth');
const ctrl = require('../controllers/shelvesController');

const router = express.Router();

// All routes require authentication
router.use(auth);

// GET /api/manuals/:manualId - Get manual item details
router.get('/:manualId', ctrl.getManualItem);

module.exports = router;
