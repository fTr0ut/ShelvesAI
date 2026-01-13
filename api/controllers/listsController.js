/**
 * Lists Controller
 * Handles user-created custom lists like "Top 10 Horror Movies"
 */

const listsQueries = require('../database/queries/lists');
const collectablesQueries = require('../database/queries/collectables');
const feedQueries = require('../database/queries/feed');

/**
 * GET /lists - List all lists for current user
 */
async function listLists(req, res) {
    try {
        const lists = await listsQueries.listForUser(req.user.id);
        res.json({ lists });
    } catch (err) {
        console.error('listLists error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * POST /lists - Create a new list
 */
async function createList(req, res) {
    try {
        const { name, description, visibility } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }

        const list = await listsQueries.create({
            userId: req.user.id,
            name: name.trim(),
            description: description?.trim() || null,
            visibility: visibility || 'private',
        });

        // Log feed event
        try {
            await feedQueries.logEvent({
                userId: req.user.id,
                shelfId: null,
                eventType: 'list.created',
                payload: {
                    listId: list.id,
                    name: list.name,
                    visibility: list.visibility,
                },
            });
        } catch (e) {
            console.warn('Failed to log list created event:', e.message);
        }

        res.status(201).json({ list });
    } catch (err) {
        console.error('createList error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /lists/:id - Get a list by ID (respects visibility)
 */
async function getList(req, res) {
    try {
        const listId = parseInt(req.params.id);
        if (isNaN(listId)) {
            return res.status(400).json({ error: 'Invalid list id' });
        }

        const list = await listsQueries.getForViewing(listId, req.user.id);
        if (!list) {
            return res.status(404).json({ error: 'List not found' });
        }

        const items = await listsQueries.getItems(listId);

        res.json({ list, items });
    } catch (err) {
        console.error('getList error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * PUT /lists/:id - Update a list's metadata
 */
async function updateList(req, res) {
    try {
        const listId = parseInt(req.params.id);
        if (isNaN(listId)) {
            return res.status(400).json({ error: 'Invalid list id' });
        }

        const { name, description, visibility } = req.body;

        const updated = await listsQueries.update(listId, req.user.id, {
            name,
            description,
            visibility,
        });

        if (!updated) {
            return res.status(404).json({ error: 'List not found' });
        }

        res.json({ list: updated });
    } catch (err) {
        console.error('updateList error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * DELETE /lists/:id - Delete a list
 */
async function deleteList(req, res) {
    try {
        const listId = parseInt(req.params.id);
        if (isNaN(listId)) {
            return res.status(400).json({ error: 'Invalid list id' });
        }

        const removed = await listsQueries.remove(listId, req.user.id);
        if (!removed) {
            return res.status(404).json({ error: 'List not found' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('deleteList error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * POST /lists/:id/items - Add an item to a list
 */
async function addListItem(req, res) {
    try {
        const listId = parseInt(req.params.id);
        if (isNaN(listId)) {
            return res.status(400).json({ error: 'Invalid list id' });
        }

        const { collectableId, position, notes } = req.body;

        if (!collectableId) {
            return res.status(400).json({ error: 'collectableId is required' });
        }

        // Verify list belongs to user
        const list = await listsQueries.getById(listId, req.user.id);
        if (!list) {
            return res.status(404).json({ error: 'List not found' });
        }

        // Verify collectable exists
        const collectable = await collectablesQueries.findById(parseInt(collectableId));
        if (!collectable) {
            return res.status(404).json({ error: 'Collectable not found' });
        }

        const item = await listsQueries.addItem({
            listId,
            collectableId: parseInt(collectableId),
            position,
            notes,
        });

        res.status(201).json({ item });
    } catch (err) {
        if (err.message.includes('cannot have more than')) {
            return res.status(400).json({ error: err.message });
        }
        console.error('addListItem error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * DELETE /lists/:id/items/:itemId - Remove an item from a list
 */
async function removeListItem(req, res) {
    try {
        const listId = parseInt(req.params.id);
        const itemId = parseInt(req.params.itemId);

        if (isNaN(listId) || isNaN(itemId)) {
            return res.status(400).json({ error: 'Invalid list or item id' });
        }

        // Verify list belongs to user
        const list = await listsQueries.getById(listId, req.user.id);
        if (!list) {
            return res.status(404).json({ error: 'List not found' });
        }

        const removed = await listsQueries.removeItem(itemId, listId);
        if (!removed) {
            return res.status(404).json({ error: 'Item not found' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('removeListItem error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * PUT /lists/:id/reorder - Reorder items in a list
 */
async function reorderListItems(req, res) {
    try {
        const listId = parseInt(req.params.id);
        if (isNaN(listId)) {
            return res.status(400).json({ error: 'Invalid list id' });
        }

        const { items } = req.body;

        if (!Array.isArray(items)) {
            return res.status(400).json({ error: 'items array is required' });
        }

        // Verify list belongs to user
        const list = await listsQueries.getById(listId, req.user.id);
        if (!list) {
            return res.status(404).json({ error: 'List not found' });
        }

        const updatedItems = await listsQueries.reorderItems(listId, items);

        res.json({ items: updatedItems });
    } catch (err) {
        if (err.message.includes('Position') || err.message.includes('Duplicate')) {
            return res.status(400).json({ error: err.message });
        }
        console.error('reorderListItems error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

module.exports = {
    listLists,
    createList,
    getList,
    updateList,
    deleteList,
    addListItem,
    removeListItem,
    reorderListItems,
};
