const express = require('express');
const rateLimit = require('express-rate-limit');
const {
    login,
    register,
    me,
    setUsername,
    forgotPassword,
    resetPassword,
    validateResetToken,
    refresh,
} = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const { requireFields } = require('../middleware/validate');

const router = express.Router();

// Rate limiting for auth endpoints to prevent brute-force attacks
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per window
    message: { error: 'Too many attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 registrations per hour per IP
    message: { error: 'Too many accounts created. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 reset attempts per window
    message: { error: 'Too many password reset attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // 30 refresh attempts per window per IP
    message: { error: 'Too many refresh attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/login', authLimiter, requireFields(['username', 'password']), login);
router.post('/register', registrationLimiter, requireFields(['username', 'password', 'email']), register);
router.get('/me', auth, me);
router.post('/username', auth, setUsername);

// Token refresh
router.post('/refresh', refreshLimiter, refresh);

// Password reset routes
router.post('/forgot-password', passwordResetLimiter, requireFields(['email']), forgotPassword);
router.post('/reset-password', passwordResetLimiter, requireFields(['token', 'password']), resetPassword);
router.get('/validate-reset-token', passwordResetLimiter, validateResetToken);

module.exports = router;
