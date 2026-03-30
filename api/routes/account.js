const express = require('express');
const { auth } = require('../middleware/auth');
const { validateStringLengths } = require('../middleware/validate');
const { getAccount, updateAccount, submitFeedback } = require('../controllers/accountController');

const router = express.Router();

router.use(auth);
router.get('/', getAccount);
router.put('/', updateAccount);
router.post('/feedback', validateStringLengths({ message: 4000 }), submitFeedback);

module.exports = router;

