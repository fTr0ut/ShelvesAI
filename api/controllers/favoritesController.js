/**
 * Favorites Controller
 * Handles adding/removing items from user's favorites
 */

const favoritesQueries = require('../database/queries/favorites');
const collectablesQueries = require('../database/queries/collectables');
const usersQueries = require('../database/queries/users');
const friendshipsQueries = require('../database/queries/friendships');
const shelvesQueries = require('../database/queries/shelves');
const { addMediaUrls } = require('../services/mediaUrl');
const { sendError, logError } = require('../utils/errorHandler');

function hydrateFavoriteMedia(favorite) {
    if (!favorite || typeof favorite !== 'object') return favorite;
    const hydrated = { ...favorite };

    if (favorite.collectable) {
        hydrated.collectable = addMediaUrls(favorite.collectable, ['coverMediaPath']);
    }

    if (favorite.manual) {
        hydrated.manual = addMediaUrls(favorite.manual, ['coverMediaPath']);
    }

    return hydrated;
}

/**
 * GET /favorites - List all favorites for current user
 */
async function listFavorites(req, res) {
    try {
        const favorites = (await favoritesQueries.listForUser(req.user.id))
            .map(hydrateFavoriteMedia);
        res.json({ favorites });
    } catch (err) {
        logError('listFavorites', err, { userId: req.user?.id });
        return sendError(res, 500, 'Server error');
    }
}

/**
 * POST /favorites - Add an item to favorites
 */
async function addFavorite(req, res) {
    try {
        const { collectableId, manualId } = req.body;

        if (!collectableId && !manualId) {
            return res.status(400).json({ error: 'collectableId or manualId is required' });
        }

        let favorite;
        if (collectableId) {
            // Verify collectable exists
            const collectable = await collectablesQueries.findById(parseInt(collectableId));
            if (!collectable) {
                return res.status(404).json({ error: 'Collectable not found' });
            }
            favorite = await favoritesQueries.addFavorite(req.user.id, parseInt(collectableId), null);
        } else if (manualId) {
            // Verify manual item exists
            const manual = await shelvesQueries.getManualById(parseInt(manualId));
            if (!manual) {
                return res.status(404).json({ error: 'Manual item not found' });
            }
            favorite = await favoritesQueries.addFavorite(req.user.id, null, parseInt(manualId));
        }

        res.status(201).json({
            success: true,
            favorite,
            isFavorite: true,
        });
    } catch (err) {
        logError('addFavorite', err, { userId: req.user?.id });
        return sendError(res, 500, 'Server error');
    }
}

/**
 * DELETE /favorites/:id - Remove an item from favorites
 * Query param ?type=manual indicates the ID is a manualId
 */
async function removeFavorite(req, res) {
    try {
        const { collectableId } = req.params; // Named in route as collectableId but can be any ID
        const targetId = parseInt(collectableId);
        const type = req.query.type;

        let removed;
        if (type === 'manual') {
            removed = await favoritesQueries.removeFavorite(req.user.id, null, targetId);
        } else {
            removed = await favoritesQueries.removeFavorite(req.user.id, targetId, null);
        }

        if (!removed) {
            return res.status(404).json({ error: 'Favorite not found' });
        }

        res.json({ success: true, isFavorite: false });
    } catch (err) {
        logError('removeFavorite', err, { userId: req.user?.id });
        return sendError(res, 500, 'Server error');
    }
}

/**
 * GET /favorites/:id/check - Check if item is favorited
 * Query param ?type=manual indicates the ID is a manualId
 */
async function checkFavorite(req, res) {
    try {
        const { collectableId } = req.params;
        const targetId = parseInt(collectableId);
        const type = req.query.type;

        let isFavorite;
        if (type === 'manual') {
            isFavorite = await favoritesQueries.isFavorite(req.user.id, null, targetId);
        } else {
            isFavorite = await favoritesQueries.isFavorite(req.user.id, targetId, null);
        }

        res.json({ isFavorite });
    } catch (err) {
        logError('checkFavorite', err, { userId: req.user?.id });
        return sendError(res, 500, 'Server error');
    }
}

/**
 * POST /favorites/check-batch - Check multiple items at once
 * Body: { collectableIds: [], manualIds: [] }
 */
async function checkFavoritesBatch(req, res) {
    try {
        const { collectableIds, manualIds } = req.body;

        const status = {};

        if (collectableIds && Array.isArray(collectableIds) && collectableIds.length > 0) {
            const parsedCollectableIds = collectableIds
                .map(id => parseInt(id, 10))
                .filter(Number.isInteger);

            const cStatus = await favoritesQueries.getFavoritesStatus(
                req.user.id,
                parsedCollectableIds
            );
            Object.assign(status, cStatus);
        }

        if (manualIds && Array.isArray(manualIds) && manualIds.length > 0) {
            const parsedManualIds = manualIds
                .map(id => parseInt(id, 10))
                .filter(Number.isInteger);

            const mStatus = await favoritesQueries.getManualFavoritesStatus(
                req.user.id,
                parsedManualIds
            );
            Object.assign(status, mStatus);
        }

        res.json({ status });
    } catch (err) {
        logError('checkFavoritesBatch', err, { userId: req.user?.id });
        return sendError(res, 500, 'Server error');
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

        const favorites = (await favoritesQueries.listForUser(targetUserId))
            .map(hydrateFavoriteMedia);
        res.json({ favorites });
    } catch (err) {
        logError('listUserFavorites', err, { userId: req.user?.id });
        return sendError(res, 500, 'Server error');
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
        logError('checkUserHasFavorites', err, { userId: req.user?.id });
        return sendError(res, 500, 'Server error');
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
