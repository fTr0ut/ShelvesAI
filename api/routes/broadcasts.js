const express = require('express');
const router = express.Router();
const broadcastLogsDb = require('../database/queries/broadcastLogs');
const logger = require('../logger');

/**
 * GET /api/broadcasts/:id/status
 * Public endpoint — mobile app calls this on SystemBroadcastModal mount
 * to check if the broadcast has been suppressed (recalled) by an admin.
 * Returns only the suppression flag; no sensitive data exposed.
 */
router.get('/:id/status', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid broadcast id' });

    try {
        const status = await broadcastLogsDb.getBroadcastStatus(id);
        if (!status) return res.status(404).json({ error: 'Broadcast not found' });

        return res.json({ isSuppressed: status.isSuppressed });
    } catch (err) {
        logger.error('Broadcast status check error:', err);
        return res.status(500).json({ error: 'Failed to check broadcast status' });
    }
});

module.exports = router;
