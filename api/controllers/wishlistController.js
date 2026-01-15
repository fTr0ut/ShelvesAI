/**
 * Wishlist Controller
 * Handles CRUD operations for wishlists and wishlist items
 */

const wishlistsQueries = require('../database/queries/wishlists');

/**
 * GET /wishlists - List all wishlists for current user
 */
async function listWishlists(req, res) {
    try {
        const wishlists = await wishlistsQueries.listForUser(req.user.id);
        res.json({ wishlists });
    } catch (err) {
        console.error('listWishlists error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /wishlists/user/:userId - List wishlists for a specific user (with visibility filtering)
 */
async function listUserWishlists(req, res) {
    try {
        const { userId } = req.params;
        const targetUserId = parseInt(userId);

        if (isNaN(targetUserId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        // Get wishlists visible to the current user
        const wishlists = await wishlistsQueries.listViewableForUser(targetUserId, req.user.id);
        res.json({ wishlists });
    } catch (err) {
        console.error('listUserWishlists error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /wishlists/user/:userId/check - Check if a user has any viewable wishlists
 */
async function checkUserHasWishlists(req, res) {
    try {
        const { userId } = req.params;
        const targetUserId = parseInt(userId);

        if (isNaN(targetUserId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const hasWishlists = await wishlistsQueries.hasViewableWishlists(targetUserId, req.user.id);
        res.json({ hasWishlists });
    } catch (err) {
        console.error('checkUserHasWishlists error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * POST /wishlists - Create a new wishlist
 */
async function createWishlist(req, res) {
    try {
        const { name, description, visibility } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const wishlist = await wishlistsQueries.create({
            userId: req.user.id,
            name: name.trim(),
            description: description?.trim() || null,
            visibility: visibility || 'private',
        });

        res.status(201).json({ wishlist });
    } catch (err) {
        console.error('createWishlist error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /wishlists/:id - Get a specific wishlist
 */
async function getWishlist(req, res) {
    try {
        const { id } = req.params;

        // First try to get as owner
        let wishlist = await wishlistsQueries.getById(parseInt(id), req.user.id);

        // If not owner, check visibility
        if (!wishlist) {
            wishlist = await wishlistsQueries.getForViewing(parseInt(id), req.user.id);
            if (!wishlist) {
                return res.status(404).json({ error: 'Wishlist not found' });
            }
        }

        // Get items
        const items = await wishlistsQueries.getItems(parseInt(id));

        res.json({ wishlist, items });
    } catch (err) {
        console.error('getWishlist error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * PUT /wishlists/:id - Update a wishlist
 */
async function updateWishlist(req, res) {
    try {
        const { id } = req.params;

        const wishlist = await wishlistsQueries.update(
            parseInt(id),
            req.user.id,
            req.body
        );

        if (!wishlist) {
            return res.status(404).json({ error: 'Wishlist not found' });
        }

        res.json({ wishlist });
    } catch (err) {
        console.error('updateWishlist error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * DELETE /wishlists/:id - Delete a wishlist
 */
async function deleteWishlist(req, res) {
    try {
        const { id } = req.params;

        const deleted = await wishlistsQueries.remove(parseInt(id), req.user.id);

        if (!deleted) {
            return res.status(404).json({ error: 'Wishlist not found' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('deleteWishlist error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /wishlists/:id/items - List items in a wishlist
 */
async function listItems(req, res) {
    try {
        const { id } = req.params;
        const { limit = 100, offset = 0 } = req.query;

        // Verify access
        const wishlist = await wishlistsQueries.getById(parseInt(id), req.user.id) ||
            await wishlistsQueries.getForViewing(parseInt(id), req.user.id);

        if (!wishlist) {
            return res.status(404).json({ error: 'Wishlist not found' });
        }

        const items = await wishlistsQueries.getItems(parseInt(id), {
            limit: parseInt(limit),
            offset: parseInt(offset),
        });

        res.json({ items });
    } catch (err) {
        console.error('listItems error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * POST /wishlists/:id/items - Add an item to a wishlist
 */
async function addItem(req, res) {
    try {
        const { id } = req.params;
        const { collectableId, manualText, notes, priority } = req.body;

        // Verify ownership
        const wishlist = await wishlistsQueries.getById(parseInt(id), req.user.id);
        if (!wishlist) {
            return res.status(404).json({ error: 'Wishlist not found' });
        }

        if (!collectableId && !manualText) {
            return res.status(400).json({ error: 'Either collectableId or manualText is required' });
        }

        const item = await wishlistsQueries.addItem({
            wishlistId: parseInt(id),
            collectableId: collectableId ? parseInt(collectableId) : null,
            manualText: manualText?.trim() || null,
            notes: notes?.trim() || null,
            priority: priority || 0,
        });

        res.status(201).json({ item });
    } catch (err) {
        console.error('addItem error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * DELETE /wishlists/:id/items/:itemId - Remove an item from a wishlist
 */
async function removeItem(req, res) {
    try {
        const { id, itemId } = req.params;

        // Verify ownership
        const wishlist = await wishlistsQueries.getById(parseInt(id), req.user.id);
        if (!wishlist) {
            return res.status(404).json({ error: 'Wishlist not found' });
        }

        const deleted = await wishlistsQueries.removeItem(parseInt(itemId), parseInt(id));

        if (!deleted) {
            return res.status(404).json({ error: 'Item not found' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('removeItem error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

module.exports = {
    listWishlists,
    listUserWishlists,
    checkUserHasWishlists,
    createWishlist,
    getWishlist,
    updateWishlist,
    deleteWishlist,
    listItems,
    addItem,
    removeItem,
};
