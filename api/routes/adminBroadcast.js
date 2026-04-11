const express = require('express');
const router = express.Router();
const broadcastLogsDb = require('../database/queries/broadcastLogs');
const { sendBroadcastNotification } = require('../services/pushNotificationService');
const logger = require('../logger');

const TITLE_MAX = 100;
const BODY_MAX = 500;

/**
 * POST /api/admin/broadcast
 * Send a broadcast push notification to all active devices
 */
router.post('/broadcast', async (req, res) => {
    const { title, body, metadata } = req.body;

    if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'title is required' });
    }
    if (typeof body !== 'string' || body.trim().length === 0) {
        return res.status(400).json({ error: 'body is required' });
    }
    if (title.trim().length > TITLE_MAX) {
        return res.status(400).json({ error: `title must be ${TITLE_MAX} characters or fewer` });
    }
    if (body.trim().length > BODY_MAX) {
        return res.status(400).json({ error: `body must be ${BODY_MAX} characters or fewer` });
    }

    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    const sentByAdminId = req.user?.id || null;

    try {
        const log = await broadcastLogsDb.createBroadcastLog({
            title: cleanTitle,
            body: cleanBody,
            metadata: metadata || null,
            sentByAdminId,
        });

        logger.info(`Admin broadcast started: id=${log.id} by=${sentByAdminId}`);

        // Run send synchronously — acceptable for current scale
        const result = await sendBroadcastNotification({
            broadcastId: log.id,
            title: cleanTitle,
            body: cleanBody,
            metadata: metadata || {},
        });

        return res.json({
            broadcastId: log.id,
            ...result,
        });
    } catch (err) {
        logger.error('Admin broadcast error:', err);
        return res.status(500).json({ error: 'Failed to send broadcast' });
    }
});

/**
 * GET /api/admin/broadcasts
 * List broadcast history
 */
router.get('/broadcasts', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    try {
        const { broadcasts, total } = await broadcastLogsDb.listBroadcasts({ limit, offset });
        return res.json({ broadcasts, total, limit, offset });
    } catch (err) {
        logger.error('Admin list broadcasts error:', err);
        return res.status(500).json({ error: 'Failed to fetch broadcasts' });
    }
});

/**
 * POST /api/admin/broadcasts/:id/cancel
 * Cancel an in-progress broadcast (stops sending between chunks)
 */
router.post('/broadcasts/:id/cancel', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid broadcast id' });

    try {
        const current = await broadcastLogsDb.getBroadcastStatus(id);
        if (!current) return res.status(404).json({ error: 'Broadcast not found' });
        if (current.status !== 'pending' && current.status !== 'running') {
            return res.status(409).json({ error: `Cannot cancel a broadcast with status '${current.status}'` });
        }

        await broadcastLogsDb.updateBroadcastLog(id, { status: 'cancelled' });
        logger.info(`Admin broadcast cancelled: id=${id} by=${req.user?.id}`);
        return res.json({ success: true });
    } catch (err) {
        logger.error('Admin cancel broadcast error:', err);
        return res.status(500).json({ error: 'Failed to cancel broadcast' });
    }
});

/**
 * POST /api/admin/broadcasts/:id/suppress
 * Suppress (recall) a broadcast — clients will dismiss the in-app modal on next check
 */
router.post('/broadcasts/:id/suppress', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid broadcast id' });

    try {
        const updated = await broadcastLogsDb.suppressBroadcast(id);
        if (!updated) return res.status(404).json({ error: 'Broadcast not found' });

        logger.info(`Admin broadcast suppressed: id=${id} by=${req.user?.id}`);
        return res.json({ success: true });
    } catch (err) {
        logger.error('Admin suppress broadcast error:', err);
        return res.status(500).json({ error: 'Failed to suppress broadcast' });
    }
});

module.exports = router;
