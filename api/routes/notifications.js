const express = require('express');
const { auth } = require('../middleware/auth');
const { requireFields } = require('../middleware/validate');
const { list, markRead, getUnreadCount } = require('../controllers/notificationController');

const router = express.Router();

router.use(auth);
router.get('/', list);
router.post('/read', requireFields(['notificationIds']), markRead);
router.get('/unread-count', getUnreadCount);

module.exports = router;
