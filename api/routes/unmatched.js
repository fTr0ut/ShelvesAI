const express = require('express');
const { auth } = require('../middleware/auth');
const needsReviewQueries = require('../database/queries/needsReview');
const shelvesQueries = require('../database/queries/shelves');
const collectablesQueries = require('../database/queries/collectables');
const { makeLightweightFingerprint, makeCollectableFingerprint } = require('../services/collectables/fingerprint');

const router = express.Router();

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
        console.error('GET /api/unmatched error:', err);
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
        console.error('GET /api/unmatched/count error:', err);
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
        console.error('DELETE /api/unmatched/all error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/unmatched/:id
 * Get a single review item
 */
router.get('/:id', async (req, res) => {
    try {
        const item = await needsReviewQueries.getById(parseInt(req.params.id, 10), req.user.id);
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }
        res.json({ item });
    } catch (err) {
        console.error('GET /api/unmatched/:id error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * PUT /api/unmatched/:id
 * Complete a review item - add it to the shelf with user-provided edits
 * 
 * Matching order:
 * 1. Fingerprint lookup (exact hash match)
 * 2. Fuzzy match (pg_trgm similarity)
 * 3. Catalog API lookup (external APIs)
 * 4. Create new collectable (if all above fail)
 */
router.put('/:id', async (req, res) => {
    try {
        const reviewItem = await needsReviewQueries.getById(parseInt(req.params.id, 10), req.user.id);
        if (!reviewItem) {
            return res.status(404).json({ error: 'Item not found' });
        }

        // Merge user edits with raw data (user edits take priority)
        const completedData = { ...reviewItem.rawData, ...req.body };
        let matchSource = null;

        // Get shelf for type info
        const shelf = await shelvesQueries.getById(reviewItem.shelfId, req.user.id);
        const shelfType = shelf?.type || reviewItem.shelfType || 'item';

        // 1. Check for existing collectable by fingerprint
        const lwf = makeLightweightFingerprint(completedData);
        let collectable = await collectablesQueries.findByLightweightFingerprint(lwf);
        if (collectable) {
            matchSource = 'fingerprint';
        }

        // 2. Fuzzy match
        if (!collectable && collectablesQueries.fuzzyMatch) {
            collectable = await collectablesQueries.fuzzyMatch(
                completedData.title,
                completedData.primaryCreator,
                shelfType
            );
            if (collectable) {
                matchSource = 'fuzzy';
            }
        }

        // 3. Catalog API lookup (new fallback)
        if (!collectable) {
            try {
                const { getCollectableMatchingService } = require('../services/collectableMatchingService');
                const matchingService = getCollectableMatchingService();
                const apiResult = await matchingService.searchCatalogAPI(completedData, shelfType);
                if (apiResult) {
                    // API returned a result - upsert it to our database
                    collectable = await collectablesQueries.upsert({
                        ...apiResult,
                        kind: shelfType,
                        fingerprint: makeCollectableFingerprint(apiResult),
                        lightweightFingerprint: makeLightweightFingerprint(apiResult),
                    });
                    matchSource = 'api';
                }
            } catch (apiErr) {
                console.warn('[PUT /api/unmatched/:id] API lookup failed:', apiErr?.message);
                // Continue to create new collectable
            }
        }

        // 4. Create new collectable if no match found
        if (!collectable) {
            collectable = await collectablesQueries.upsert({
                ...completedData,
                kind: shelfType,
                fingerprint: makeCollectableFingerprint(completedData),
                lightweightFingerprint: lwf,
            });
            matchSource = 'new';
        }

        // Add to user's shelf
        const shelfItem = await shelvesQueries.addCollectable({
            userId: req.user.id,
            shelfId: reviewItem.shelfId,
            collectableId: collectable.id,
        });

        // Mark review item as completed
        await needsReviewQueries.markCompleted(reviewItem.id, req.user.id);

        res.json({
            success: true,
            matchSource,
            item: {
                id: shelfItem.id,
                collectable,
                position: shelfItem.position,
            },
        });
    } catch (err) {
        console.error('PUT /api/unmatched/:id error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * DELETE /api/unmatched/:id
 * Dismiss a review item without adding to shelf
 */
router.delete('/:id', async (req, res) => {
    try {
        const result = await needsReviewQueries.dismiss(parseInt(req.params.id, 10), req.user.id);
        if (!result) {
            return res.status(404).json({ error: 'Item not found' });
        }
        res.json({ success: true, dismissed: true, id: req.params.id });
    } catch (err) {
        console.error('DELETE /api/unmatched/:id error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
