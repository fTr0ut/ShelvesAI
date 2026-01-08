const express = require('express');
const { auth } = require('../middleware/auth');
const { getAccount, updateAccount } = require('../controllers/accountController');

const router = express.Router();

router.use(auth);
router.get('/', getAccount);
router.put('/', updateAccount);

module.exports = router;

