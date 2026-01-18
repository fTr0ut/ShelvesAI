/**
 * Controller for decoupled ratings
 */
const ratingsQueries = require('../database/queries/ratings');
const collectablesQueries = require('../database/queries/collectables');
const feedQueries = require('../database/queries/feed');

async function getRating(req, res) {
    try {
        const { collectableId } = req.params;
        const rating = await ratingsQueries.getRating(req.user.id, collectableId);
        res.json({ rating: rating?.rating || 0 });
    } catch (err) {
        console.error('getRating error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

async function setRating(req, res) {
    try {
        const { collectableId } = req.params;
        const { rating } = req.body;

        const result = await ratingsQueries.setRating(req.user.id, collectableId, rating);

        // Log feed event if rating was set (not cleared)
        if (result && result.rating) {
            const collectable = await collectablesQueries.findById(collectableId);
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
                        coverMediaPath: collectable.coverMediaPath || null,
                        rating: result.rating,
                        type: collectable.kind || 'item',
                    },
                });
            }
        }

        res.json({ rating: result?.rating || 0 });
    } catch (err) {
        console.error('setRating error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}


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

async function getUserRating(req, res) {
    try {
        const { collectableId, userId } = req.params;
        const rating = await ratingsQueries.getRating(userId, collectableId);
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
