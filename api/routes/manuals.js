const express = require('express');
const { auth } = require('../middleware/auth');
const { validateIntParam } = require('../middleware/validate');
const ctrl = require('../controllers/shelvesController');
const shelvesQueries = require('../database/queries/shelves');
const { normalizeComparableId } = require('../utils/identity');
const logger = require('../logger');

const router = express.Router();

// All routes require authentication
router.use(auth);

function logShelfItemResolution(context, payload) {
    if (process.env.NODE_ENV === 'production') return;
    logger.info(`[${context}] shelf-item resolved`, payload);
}

// GET /api/manuals/:manualId - Get manual item details
router.get('/:manualId', validateIntParam(['manualId']), ctrl.getManualItem);

// GET /api/manuals/:manualId/shelf-item - Check if current user owns this manual item (get shelf connection)
router.get('/:manualId/shelf-item', validateIntParam(['manualId']), async (req, res) => {
    try {
        const manualId = parseInt(req.params.manualId, 10);
        const userId = normalizeComparableId(req.user.id);
        const ownerOverrideProvided = Object.prototype.hasOwnProperty.call(req.query || {}, 'ownerId');
        const requestedOwnerId = ownerOverrideProvided
            ? normalizeComparableId(req.query.ownerId)
            : userId;

        if (!requestedOwnerId) {
            return res.status(400).json({ error: "Invalid ownerId" });
        }

        const resolution = await shelvesQueries.findLatestAccessibleCollectionItemByReference({
            viewerUserId: userId,
            requestedOwnerId,
            manualId,
        });

        if (!resolution) {
            logShelfItemResolution('manuals.shelfItem', {
                viewerUserId: userId,
                requestedOwnerId,
                manualId,
                owned: false,
                viewable: false,
                shelfId: null,
                itemId: null,
                hasHydratedItem: false,
            });
            return res.json({ owned: false });
        }

        const formattedItem = resolution.item
            ? ctrl._helpers.formatShelfItem(resolution.item)
            : null;
        const responseItem = resolution.owned
            ? formattedItem
            : ctrl._helpers.redactShelfItemForViewer(formattedItem);

        logShelfItemResolution('manuals.shelfItem', {
            viewerUserId: userId,
            requestedOwnerId,
            manualId,
            owned: resolution.owned,
            viewable: resolution.viewable === true,
            shelfId: resolution.shelfId,
            itemId: resolution.itemId,
            hasHydratedItem: !!responseItem,
        });
        return res.json({
            owned: resolution.owned,
            ...(resolution.viewable ? { viewable: true } : {}),
            shelfId: resolution.shelfId,
            itemId: resolution.itemId,
            ...(responseItem ? { item: responseItem } : {}),
        });
    } catch (err) {
        logger.error('GET /api/manuals/:manualId/shelf-item error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
