/**
 * Favorites Controller
 * Handles adding/removing items from user's favorites
 */

const favoritesQueries = require('../database/queries/favorites');
const collectablesQueries = require('../database/queries/collectables');
const feedQueries = require('../database/queries/feed');

/**
 * GET /favorites - List all favorites for current user
 */
async function listFavorites(req, res) {
    try {
        const favorites = await favoritesQueries.listForUser(req.user.id);
        res.json({ favorites });
    } catch (err) {
        console.error('listFavorites error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * POST /favorites - Add an item to favorites
 */
async function addFavorite(req, res) {
    try {
        const { collectableId } = req.body;

        if (!collectableId) {
            return res.status(400).json({ error: 'collectableId is required' });
        }

        // Verify collectable exists
        const collectable = await collectablesQueries.findById(parseInt(collectableId));
        if (!collectable) {
            return res.status(404).json({ error: 'Collectable not found' });
        }

        const favorite = await favoritesQueries.addFavorite(req.user.id, parseInt(collectableId));

        // Log feed event
        try {
            await feedQueries.logEvent({
                userId: req.user.id,
                shelfId: null, // Favorites aren't shelf-specific
                eventType: 'item.favorited',
                payload: {
                    collectableId: collectable.id,
                    title: collectable.title,
                    primaryCreator: collectable.primaryCreator,
                    coverUrl: collectable.coverUrl || '',
                    type: collectable.kind,
                },
            });
        } catch (e) {
            console.warn('Failed to log favorite event:', e.message);
        }

        res.status(201).json({
            success: true,
            favorite,
            isFavorite: true,
        });
    } catch (err) {
        console.error('addFavorite error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * DELETE /favorites/:collectableId - Remove an item from favorites
 */
async function removeFavorite(req, res) {
    try {
        const { collectableId } = req.params;

        const removed = await favoritesQueries.removeFavorite(
            req.user.id,
            parseInt(collectableId)
        );

        if (!removed) {
            return res.status(404).json({ error: 'Favorite not found' });
        }

        res.json({ success: true, isFavorite: false });
    } catch (err) {
        console.error('removeFavorite error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /favorites/:collectableId/check - Check if item is favorited
 */
async function checkFavorite(req, res) {
    try {
        const { collectableId } = req.params;

        const isFavorite = await favoritesQueries.isFavorite(
            req.user.id,
            parseInt(collectableId)
        );

        res.json({ isFavorite });
    } catch (err) {
        console.error('checkFavorite error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * POST /favorites/check-batch - Check multiple items at once
 */
async function checkFavoritesBatch(req, res) {
    try {
        const { collectableIds } = req.body;

        if (!Array.isArray(collectableIds)) {
            return res.status(400).json({ error: 'collectableIds array is required' });
        }

        const status = await favoritesQueries.getFavoritesStatus(
            req.user.id,
            collectableIds.map(id => parseInt(id))
        );

        res.json({ status });
    } catch (err) {
        console.error('checkFavoritesBatch error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

module.exports = {
    listFavorites,
    addFavorite,
    removeFavorite,
    checkFavorite,
    checkFavoritesBatch,
};
