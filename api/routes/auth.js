const express = require('express');
const { login, register, me, setUsername } = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const { requireFields } = require('../middleware/validate');

const router = express.Router();

router.post('/login', requireFields(['username', 'password']), login);
router.post('/register', requireFields(['username', 'password', 'email']), register);
router.get('/me', auth, me);
router.post('/username', auth, setUsername);

module.exports = router;
