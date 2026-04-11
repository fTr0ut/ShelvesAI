const express = require('express');
const { auth } = require('../middleware/auth');
const { requireFields, validateUUID, validateIntParam, validateStringLengths } = require('../middleware/validate');
const {
  listFriendships,
  sendFriendRequest,
  respondToRequest,
  searchUsers,
  removeFriendship,
  blockUser,
  listBlockedUsers,
  unblockUser,
} = require('../controllers/friendController');

const router = express.Router();

router.use(auth);
router.get('/search', validateStringLengths({ q: 500, query: 500 }, { source: 'query' }), searchUsers);
router.get('/', listFriendships);
router.get('/blocks', listBlockedUsers);
router.post('/blocks', requireFields(['targetUserId']), validateUUID(['targetUserId']), blockUser);
router.delete('/blocks/:targetUserId', validateUUID(['targetUserId']), unblockUser);
router.post('/request', requireFields(['targetUserId']), validateUUID(['targetUserId']), sendFriendRequest);
router.post('/respond', requireFields(['friendshipId', 'action']), validateIntParam(['friendshipId']), respondToRequest);
router.delete('/:id', validateIntParam(['id']), removeFriendship);

module.exports = router;

