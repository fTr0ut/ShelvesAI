/**
 * Discover Routes
 *
 * Endpoints for the personalized news/discover feed.
 */

const express = require('express');
const { optionalAuth } = require('../middleware/auth');
const { getDiscover, getDiscoverStats } = require('../controllers/discoverController');

const router = express.Router();

// Use optional auth - personalization works better with user, but feed is viewable without
router.use(optionalAuth);

// GET /api/discover - Get personalized discover feed
router.get('/', getDiscover);

// GET /api/discover/stats - Get cache statistics
router.get('/stats', getDiscoverStats);

module.exports = router;
