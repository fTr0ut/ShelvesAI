const express = require('express');
const { auth } = require('../middleware/auth');
const { validateIntParam } = require('../middleware/validate');
const ctrl = require('../controllers/shelvesController');
const { query } = require('../database/pg');

const router = express.Router();

// All routes require authentication
router.use(auth);

// GET /api/manuals/:manualId - Get manual item details
router.get('/:manualId', validateIntParam(['manualId']), ctrl.getManualItem);

// GET /api/manuals/:manualId/shelf-item - Check if current user owns this manual item (get shelf connection)
router.get('/:manualId/shelf-item', validateIntParam(['manualId']), async (req, res) => {
    try {
        const manualId = parseInt(req.params.manualId, 10);
        const userId = req.user.id;
        const result = await query(
            `SELECT id as item_id, shelf_id
             FROM user_collections
             WHERE user_id = $1 AND manual_id = $2
             ORDER BY created_at DESC LIMIT 1`,
            [userId, manualId]
        );
        if (!result.rows.length) {
            return res.json({ owned: false });
        }
        return res.json({
            owned: true,
            shelfId: result.rows[0].shelf_id,
            itemId: result.rows[0].item_id
        });
    } catch (err) {
        console.error('GET /api/manuals/:manualId/shelf-item error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
