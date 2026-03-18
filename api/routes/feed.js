const express = require('express');
const { auth } = require('../middleware/auth');
const { validateStringLengths, validateIntParam } = require('../middleware/validate');
const { getFeed, getFeedEntryDetails } = require('../controllers/feedController');
const { toggleLike, addComment, getComments, deleteComment } = require('../controllers/eventSocialController');

const router = express.Router();

router.use(auth);
router.get('/', getFeed);
router.post('/:eventId/like', toggleLike);
router.post('/:eventId/comments', validateStringLengths({ content: 2000 }), addComment);
router.get('/:eventId/comments', getComments);
router.delete('/:eventId/comments/:commentId', validateIntParam(['commentId']), deleteComment);
router.get('/:shelfId', getFeedEntryDetails);

module.exports = router;

