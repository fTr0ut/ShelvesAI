const express = require('express');
const { auth } = require('../middleware/auth');
const {
    registerPushToken,
    unregisterPushToken,
    getNotificationPreferences,
    updateNotificationPreferences,
} = require('../controllers/pushController');

const router = express.Router();

// All routes require authentication
router.use(auth);

// POST /api/push/register - Register device token
router.post('/register', registerPushToken);

// POST /api/push/unregister - Remove device token
router.post('/unregister', unregisterPushToken);

// GET /api/push/preferences - Get notification preferences
router.get('/preferences', getNotificationPreferences);

// PATCH /api/push/preferences - Update notification preferences
router.patch('/preferences', updateNotificationPreferences);

module.exports = router;
