/**
 * Controller for decoupled ratings
 * Supports rating both collectables and user_manuals items
 */
const ratingsQueries = require('../database/queries/ratings');
const collectablesQueries = require('../database/queries/collectables');
const shelvesQueries = require('../database/queries/shelves');
const feedQueries = require('../database/queries/feed');
const { resolveMediaUrl } = require('../services/mediaUrl');

/**
 * GET /api/ratings/:itemId
 * Get rating for an item. Query param ?type=manual for manual items.
 */
async function getRating(req, res) {
    try {
        const { itemId } = req.params;
        const isManual = req.query.type === 'manual';

        const rating = await ratingsQueries.getRating(
            req.user.id,
            isManual ? { manualId: itemId } : { collectableId: itemId }
        );
        res.json({ rating: rating?.rating || 0 });
    } catch (err) {
        console.error('getRating error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * PUT /api/ratings/:itemId
 * Set rating for an item. Query param ?type=manual for manual items.
 */
async function setRating(req, res) {
    try {
        const { itemId } = req.params;
        const { rating } = req.body;
        const isManual = req.query.type === 'manual';

        const result = await ratingsQueries.setRating(
            req.user.id,
            isManual ? { manualId: itemId } : { collectableId: itemId },
            rating
        );

        // Log feed event if rating was set (not cleared)
        if (result && result.rating) {
            if (isManual) {
                // Manual item rating
                const manual = await shelvesQueries.getManualById(itemId);
                if (manual) {
                    await feedQueries.logEvent({
                        userId: req.user.id,
                        shelfId: manual.shelfId || null,
                        eventType: 'item.rated',
                        payload: {
                            manualId: manual.id,
                            title: manual.name || 'Unknown',
                            primaryCreator: manual.author || null,
                            coverUrl: null,
                            rating: result.rating,
                            type: manual.type || 'item',
                        },
                    });
                }
            } else {
                // Collectable item rating
                const collectable = await collectablesQueries.findById(itemId);
                if (collectable) {
                    await feedQueries.logEvent({
                        userId: req.user.id,
                        shelfId: null, // Global aggregation for ratings
                        eventType: 'item.rated',
                        payload: {
                            collectableId: collectable.id,
                            title: collectable.title || 'Unknown',
                            primaryCreator: collectable.primaryCreator || null,
                            coverUrl: collectable.coverUrl || null,
                            coverImageUrl: collectable.coverImageUrl || null,
                            coverImageSource: collectable.coverImageSource || null,
                            coverMediaPath: collectable.coverMediaPath || null,
                            coverMediaUrl: resolveMediaUrl(collectable.coverMediaPath),
                            rating: result.rating,
                            type: collectable.kind || 'item',
                        },
                    });
                }
            }
        }

        res.json({ rating: result?.rating || 0 });
    } catch (err) {
        console.error('setRating error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/ratings/:collectableId/aggregate
 * Get aggregate rating stats for a collectable.
 * Note: Aggregate ratings only apply to collectables (shared catalog items).
 */
async function getAggregateRating(req, res) {
    try {
        const { collectableId } = req.params;
        const stats = await ratingsQueries.getAggregateRating(collectableId);
        res.json(stats);
    } catch (err) {
        console.error('getAggregateRating error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/ratings/:itemId/user/:userId
 * Get another user's rating for an item. Query param ?type=manual for manual items.
 */
async function getUserRating(req, res) {
    try {
        const { itemId, userId } = req.params;
        const isManual = req.query.type === 'manual';

        const rating = await ratingsQueries.getRating(
            userId,
            isManual ? { manualId: itemId } : { collectableId: itemId }
        );
        res.json({ rating: rating?.rating || 0 });
    } catch (err) {
        console.error('getUserRating error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

module.exports = {
    getRating,
    setRating,
    getAggregateRating,
    getUserRating,
};
