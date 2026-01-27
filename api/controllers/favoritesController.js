/**
 * Favorites Controller
 * Handles adding/removing items from user's favorites
 */

const favoritesQueries = require('../database/queries/favorites');
const collectablesQueries = require('../database/queries/collectables');
const feedQueries = require('../database/queries/feed');
const usersQueries = require('../database/queries/users');
const friendshipsQueries = require('../database/queries/friendships');

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

/**
 * GET /favorites/user/:userId - List favorites for a specific user (filters private users)
 */
async function listUserFavorites(req, res) {
    try {
        const { userId } = req.params;
        const targetUserId = userId;
        const viewerId = req.user.id;

        if (!targetUserId || typeof targetUserId !== 'string') {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        // Check if viewing own profile
        const isOwner = targetUserId === viewerId;

        if (!isOwner) {
            // Check privacy settings (normalize error responses to prevent user enumeration)
            const user = await usersQueries.findById(targetUserId);

            // If user doesn't exist or is private, check friendship before returning error
            if (!user || user.is_private) {
                const areFriends = user ? await friendshipsQueries.areFriends(viewerId, targetUserId) : false;
                if (!areFriends) {
                    return res.status(403).json({ error: 'Profile not accessible' });
                }
            }
        }

        const favorites = await favoritesQueries.listForUser(targetUserId);
        res.json({ favorites });
    } catch (err) {
        console.error('listUserFavorites error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /favorites/user/:userId/check - Check if a user has any favorites (for profile button visibility)
 */
async function checkUserHasFavorites(req, res) {
    try {
        const { userId } = req.params;
        const targetUserId = userId;
        const viewerId = req.user.id;

        if (!targetUserId || typeof targetUserId !== 'string') {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        // Check availability (same logic as list)
        // We only show the button if the user would be allowed to see the list
        const isOwner = targetUserId === viewerId;

        if (!isOwner) {
            const user = await usersQueries.findById(targetUserId);
            if (!user) {
                return res.json({ hasFavorites: false }); // Or 404, but false is safer for UI checks
            }
            if (user.is_private) {
                const areFriends = await friendshipsQueries.areFriends(viewerId, targetUserId);
                if (!areFriends) {
                    return res.json({ hasFavorites: false }); // Not viewable -> pretend empty
                }
            }
        }

        // For efficiency, we just get the list and check length. 
        // Optimization: Could add a COUNT query if lists become massive.
        const favorites = await favoritesQueries.listForUser(targetUserId);
        res.json({ hasFavorites: favorites.length > 0 });
    } catch (err) {
        console.error('checkUserHasFavorites error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

module.exports = {
    listFavorites,
    listUserFavorites,
    checkUserHasFavorites,
    addFavorite,
    removeFavorite,
    checkFavorite,
    checkFavoritesBatch,
};
