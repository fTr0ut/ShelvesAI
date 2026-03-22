const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { requireAdminCsrf } = require('../middleware/csrf');
const adminController = require('../controllers/adminController');
const { adminLogin } = require('../controllers/authController');
const { requireFields } = require('../middleware/validate');
const logger = require('../logger');

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    const ip = req.headers['cf-connecting-ip'] || req.ip;
    logger.warn(`[AdminLoginLimiter] Too many admin login attempts from ${ip}`);
    res.status(options.statusCode).json(options.message);
  },
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

router.get('/me', adminController.getMe);

// Dashboard statistics
router.get('/stats', adminController.getStats);

// User management
router.get('/users', adminController.listUsers);
router.get('/users/:userId', adminController.getUser);

// System settings (read — no CSRF required)
router.get('/settings', adminController.getSettings);
router.get('/settings/:key', adminController.getSetting);

// CSRF required for admin state-changing routes.
router.use(requireAdminCsrf);

router.post('/logout', adminController.logout);
router.post('/users/:userId/suspend', adminController.suspendUser);
router.post('/users/:userId/unsuspend', adminController.unsuspendUser);
router.post('/users/:userId/toggle-admin', adminController.toggleAdmin);

// Activity monitoring
router.get('/feed/recent', adminController.getRecentFeed);
router.get('/jobs', adminController.listJobs);
router.get('/jobs/:jobId', adminController.getJob);

// System info
router.get('/system', adminController.getSystemInfo);

// System settings (write — CSRF required)
router.put('/settings/:key', adminController.updateSetting);

module.exports = router;
