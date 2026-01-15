const express = require('express');
const { auth } = require('../middleware/auth');
const feedQueries = require('../database/queries/feed');
const collectablesQueries = require('../database/queries/collectables');

const router = express.Router();

router.use(auth);

/**
 * POST /api/checkin
 * Create a check-in event for the authenticated user
 * 
 * Body: {
 *   collectableId: number (required) - ID of the collectable
 *   status: 'starting' | 'continuing' | 'completed' (required)
 *   visibility: 'public' | 'friends' (optional, defaults to 'public')
 *   note: string (optional) - user message/comment
 * }
 */
router.post('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const { collectableId, status, visibility = 'public', note } = req.body || {};

        // Validate required fields
        if (!collectableId) {
            return res.status(400).json({ error: 'collectableId is required' });
        }
        if (!status) {
            return res.status(400).json({ error: 'status is required' });
        }

        // Verify the collectable exists
        const collectable = await collectablesQueries.findById(collectableId);
        if (!collectable) {
            return res.status(404).json({ error: 'Collectable not found' });
        }

        // Create the check-in event
        const event = await feedQueries.logCheckIn({
            userId,
            collectableId,
            status,
            visibility,
            note: note?.trim() || null,
        });

        res.status(201).json({
            event: {
                id: event.id,
                eventType: event.eventType,
                status: event.checkinStatus,
                visibility: event.visibility,
                note: event.note,
                createdAt: event.createdAt,
                collectable: {
                    id: collectable.id,
                    title: collectable.title,
                    primaryCreator: collectable.primaryCreator,
                    coverUrl: collectable.coverUrl,
                    coverMediaPath: collectable.coverMediaPath,
                    kind: collectable.kind,
                },
            },
        });
    } catch (err) {
        console.error('POST /api/checkin error:', err);
        if (err.message?.includes('required') || err.message?.includes('Invalid')) {
            return res.status(400).json({ error: err.message });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
