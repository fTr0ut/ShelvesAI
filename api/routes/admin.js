const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const adminController = require('../controllers/adminController');
const { adminLogin } = require('../controllers/authController');
const { requireFields } = require('../middleware/validate');

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 150,
  message: { error: 'Too many admin requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin login (requires admin credentials, no auth token yet)
router.post('/login', adminLoginLimiter, requireFields(['username', 'password']), adminLogin);

// All admin routes require authentication and admin privileges
router.use(auth);
router.use(requireAdmin);
router.use(adminLimiter);

// Dashboard statistics
router.get('/stats', adminController.getStats);

// User management
router.get('/users', adminController.listUsers);
router.get('/users/:userId', adminController.getUser);
router.post('/users/:userId/suspend', adminController.suspendUser);
router.post('/users/:userId/unsuspend', adminController.unsuspendUser);
router.post('/users/:userId/toggle-admin', adminController.toggleAdmin);

// Activity monitoring
router.get('/feed/recent', adminController.getRecentFeed);

// System info
router.get('/system', adminController.getSystemInfo);

module.exports = router;
