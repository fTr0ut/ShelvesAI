/**
 * Discover Routes
 *
 * Endpoints for the personalized news/discover feed.
 */

const express = require('express');
const { auth, optionalAuth } = require('../middleware/auth');
const { getDiscover, getDiscoverStats, dismissDiscoverItem } = require('../controllers/discoverController');

const router = express.Router();

// Use optional auth - personalization works better with user, but feed is viewable without
router.use(optionalAuth);

// GET /api/discover - Get personalized discover feed
router.get('/', getDiscover);

// GET /api/discover/stats - Get cache statistics
router.get('/stats', getDiscoverStats);

// POST /api/discover/dismiss - Dismiss a discover item with a negative vote
router.post('/dismiss', auth, dismissDiscoverItem);

module.exports = router;
