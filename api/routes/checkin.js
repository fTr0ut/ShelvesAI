const express = require('express');
const { auth } = require('../middleware/auth');
const feedQueries = require('../database/queries/feed');
const collectablesQueries = require('../database/queries/collectables');
const { query } = require('../database/pg');
const { rowToCamelCase } = require('../database/queries/utils');

const router = express.Router();

router.use(auth);

/**
 * GET /api/checkin/search
 * Search catalog collectables plus the user's manual entries.
 *
 * Query: q (required), limit (optional), wildcard (optional)
 */
router.get('/search', async (req, res) => {
    try {
        const userId = req.user.id;
        const q = String(req.query.q || '').trim();
        const limit = Math.min(parseInt(req.query.limit || '10', 10), 50);
        const useWildcard = String(req.query.wildcard || '').toLowerCase() === 'true';

        if (!q) {
            return res.json({ results: [] });
        }

        let sql;
        let params;

        if (useWildcard && q.includes('*')) {
            const sqlPattern = q.replace(/\*/g, '%');
            sql = `
        SELECT id, title, primary_creator, kind, cover_url, cover_media_path, source
        FROM (
          SELECT c.id, c.title, c.primary_creator, c.kind, c.cover_url,
                 m.local_path as cover_media_path, 'collectable' as source,
                 c.title as sort_title
          FROM collectables c
          LEFT JOIN media m ON m.id = c.cover_media_id
          WHERE c.title ILIKE $1 OR c.primary_creator ILIKE $1
          UNION ALL
          SELECT um.id, um.name as title, um.author as primary_creator, COALESCE(um.type, 'manual') as kind,
                 NULL::text as cover_url, NULL::text as cover_media_path, 'manual' as source,
                 um.name as sort_title
          FROM user_manuals um
          WHERE um.user_id = $2 AND (um.name ILIKE $1 OR um.author ILIKE $1)
        ) results
        ORDER BY sort_title ASC
        LIMIT $3`;
            params = [sqlPattern, userId, limit];
        } else {
            sql = `
        SELECT id, title, primary_creator, kind, cover_url, cover_media_path, source
        FROM (
          SELECT c.id, c.title, c.primary_creator, c.kind, c.cover_url,
                 m.local_path as cover_media_path, 'collectable' as source,
                 GREATEST(similarity(c.title, $1), similarity(COALESCE(c.primary_creator, ''), $1)) AS score
          FROM collectables c
          LEFT JOIN media m ON m.id = c.cover_media_id
          WHERE c.title % $1 OR c.primary_creator % $1
          UNION ALL
          SELECT um.id, um.name as title, um.author as primary_creator, COALESCE(um.type, 'manual') as kind,
                 NULL::text as cover_url, NULL::text as cover_media_path, 'manual' as source,
                 GREATEST(similarity(um.name, $1), similarity(COALESCE(um.author, ''), $1)) AS score
          FROM user_manuals um
          WHERE um.user_id = $2 AND (um.name % $1 OR um.author % $1)
        ) results
        ORDER BY score DESC NULLS LAST, title ASC
        LIMIT $3`;
            params = [q, userId, limit];
        }

        const result = await query(sql, params);
        res.json({ results: result.rows.map(rowToCamelCase) });
    } catch (err) {
        console.error('GET /api/checkin/search error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/checkin
 * Create a check-in event for the authenticated user
 * 
 * Body: {
 *   collectableId: number (required when manualId absent) - ID of the collectable
 *   manualId: number (required when collectableId absent) - ID of the user's manual entry
 *   status: 'starting' | 'continuing' | 'completed' (required)
 *   visibility: 'public' | 'friends' (optional, defaults to 'public')
 *   note: string (optional) - user message/comment
 * }
 */
router.post('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const { collectableId, manualId, status, visibility = 'public', note } = req.body || {};

        // Validate required fields
        if (!collectableId && !manualId) {
            return res.status(400).json({ error: 'collectableId or manualId is required' });
        }
        if (collectableId && manualId) {
            return res.status(400).json({ error: 'collectableId and manualId cannot both be set' });
        }
        if (!status) {
            return res.status(400).json({ error: 'status is required' });
        }

        let collectable = null;
        let manual = null;

        if (collectableId) {
            // Verify the collectable exists
            collectable = await collectablesQueries.findById(collectableId);
            if (!collectable) {
                return res.status(404).json({ error: 'Collectable not found' });
            }
        } else {
            const manualResult = await query(
                'SELECT * FROM user_manuals WHERE id = $1 AND user_id = $2',
                [manualId, userId]
            );
            manual = manualResult.rows[0] ? rowToCamelCase(manualResult.rows[0]) : null;
            if (!manual) {
                return res.status(404).json({ error: 'Manual item not found' });
            }
        }

        // Create the check-in event
        const event = await feedQueries.logCheckIn({
            userId,
            collectableId: collectable?.id || null,
            manualId: manual?.id || null,
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
                collectable: collectable ? {
                    id: collectable.id,
                    title: collectable.title,
                    primaryCreator: collectable.primaryCreator,
                    coverUrl: collectable.coverUrl,
                    coverMediaPath: collectable.coverMediaPath,
                    kind: collectable.kind,
                } : null,
                manual: manual ? {
                    id: manual.id,
                    title: manual.name,
                    primaryCreator: manual.author || null,
                    kind: manual.type || 'manual',
                } : null,
                source: manual ? 'manual' : 'collectable',
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
