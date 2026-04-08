const express = require('express');
const { auth } = require('../middleware/auth');
const { validateIntParam } = require('../middleware/validate');
const needsReviewQueries = require('../database/queries/needsReview');
const shelvesQueries = require('../database/queries/shelves');
const { completeReviewItemInternal } = require('../controllers/shelvesController');
const logger = require('../logger');

const router = express.Router();

function omitMarketValueSources(entity) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return entity;
    const { marketValueSources, ...rest } = entity;
    return rest;
}

function omitMarketValueSourcesDeep(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => omitMarketValueSourcesDeep(entry));
    }
    if (!value || typeof value !== 'object') return value;
    const sanitized = omitMarketValueSources(value);
    const output = {};
    for (const [key, nested] of Object.entries(sanitized)) {
        output[key] = omitMarketValueSourcesDeep(nested);
    }
    return output;
}

// All routes require authentication
router.use(auth);

/**
 * GET /api/unmatched
 * List all pending review items for the current user across all shelves
 */
router.get('/', async (req, res) => {
    try {
        const items = await needsReviewQueries.listAllPendingForUser(req.user.id);
        const count = items.length;

        res.json({ items, count });
    } catch (err) {
        logger.error('GET /api/unmatched error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/unmatched/count
 * Get count of pending review items (for badge display)
 */
router.get('/count', async (req, res) => {
    try {
        const count = await needsReviewQueries.countPendingForUser(req.user.id);
        res.json({ count });
    } catch (err) {
        logger.error('GET /api/unmatched/count error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * DELETE /api/unmatched/all
 * Dismiss all pending review items for the current user
 */
router.delete('/all', async (req, res) => {
    try {
        const count = await needsReviewQueries.dismissAllForUser(req.user.id);
        res.json({ success: true, dismissed: count });
    } catch (err) {
        logger.error('DELETE /api/unmatched/all error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

const unmatchedIntParam = validateIntParam(['id']);

/**
 * GET /api/unmatched/:id
 * Get a single review item
 */
router.get('/:id', unmatchedIntParam, async (req, res) => {
    try {
        const item = await needsReviewQueries.getById(parseInt(req.params.id, 10), req.user.id);
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }
        res.json({ item });
    } catch (err) {
        logger.error('GET /api/unmatched/:id error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * PUT /api/unmatched/:id
 * Complete a review item using the shared shelf review workflow.
 */
router.put('/:id', unmatchedIntParam, async (req, res) => {
    try {
        const reviewItem = await needsReviewQueries.getById(parseInt(req.params.id, 10), req.user.id);
        if (!reviewItem) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const shelf = await shelvesQueries.getById(reviewItem.shelfId, req.user.id);
        if (!shelf) {
            return res.status(404).json({ error: 'Shelf not found' });
        }

        const result = await completeReviewItemInternal({
            userId: req.user.id,
            shelf,
            reviewItem,
            body: req.body,
        });

        return res.json({
            success: true,
            matchSource: result.matchSource,
            item: omitMarketValueSourcesDeep(result.item),
        });
    } catch (err) {
        if (err?.statusCode) {
            return res.status(err.statusCode).json({ error: err.message || 'Server error' });
        }
        logger.error('PUT /api/unmatched/:id error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * DELETE /api/unmatched/:id
 * Dismiss a review item without adding to shelf
 */
router.delete('/:id', unmatchedIntParam, async (req, res) => {
    try {
        const result = await needsReviewQueries.dismiss(parseInt(req.params.id, 10), req.user.id);
        if (!result) {
            return res.status(404).json({ error: 'Item not found' });
        }
        res.json({ success: true, dismissed: true, id: req.params.id });
    } catch (err) {
        logger.error('DELETE /api/unmatched/:id error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
