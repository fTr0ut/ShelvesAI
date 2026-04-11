const express = require('express');
const { auth } = require('../middleware/auth');
const { validateStringLengths } = require('../middleware/validate');
const { getAccount, updateAccount, submitFeedback, getDeletionRequestStatus, requestAccountDeletion, revokeDeletionRequest } = require('../controllers/accountController');

const router = express.Router();

router.use(auth);
router.get('/', getAccount);
router.put('/', updateAccount);
router.post('/feedback', validateStringLengths({ message: 4000 }), submitFeedback);
router.get('/deletion-request', getDeletionRequestStatus);
router.post('/deletion-request', requestAccountDeletion);
router.delete('/deletion-request', revokeDeletionRequest);

module.exports = router;

