const express = require('express');
const { auth } = require('../middleware/auth');
const { requireFields, validateUUID } = require('../middleware/validate');
const { listFriendships, sendFriendRequest, respondToRequest, searchUsers, removeFriendship } = require('../controllers/friendController');

const router = express.Router();

router.use(auth);
router.get('/search', searchUsers);
router.get('/', listFriendships);
router.post('/request', requireFields(['targetUserId']), validateUUID(['targetUserId']), sendFriendRequest);
router.post('/respond', requireFields(['friendshipId', 'action']), respondToRequest);
router.delete('/:id', removeFriendship);

module.exports = router;

