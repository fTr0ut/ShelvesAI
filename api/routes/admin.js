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
router.get('/stats/detailed', adminController.getDetailedStats);

// User management (read)
router.get('/users', adminController.listUsers);
router.get('/users/:userId', adminController.getUser);
router.get('/users/:userId/vision-quota', adminController.getUserVisionQuota);

// System settings (read — no CSRF required)
router.get('/settings', adminController.getSettings);
router.get('/settings/:key', adminController.getSetting);

// Activity monitoring (read)
router.get('/feed/recent', adminController.getRecentFeed);
router.get('/feed/social', adminController.getAdminSocialFeed);
router.get('/feed/events/:eventId/comments', adminController.getAdminEventComments);
router.get('/workfeed', adminController.listWorkfeed);
router.get('/workfeed/:jobId', adminController.getWorkfeedJob);
router.get('/jobs', adminController.listJobs);
router.get('/jobs/:jobId', adminController.getJob);

// Audit logs (read)
router.get('/audit-logs', adminController.listAuditLogs);

// Content browsing (read)
router.get('/shelves', adminController.listShelves);
router.get('/shelves/:shelfId', adminController.getShelf);
router.get('/shelves/:shelfId/items', adminController.getShelfItems);

// System info
router.get('/system', adminController.getSystemInfo);

// CSRF required for admin state-changing routes.
router.use(requireAdminCsrf);

router.post('/logout', adminController.logout);

// Event moderation
router.delete('/feed/events/:eventId', adminController.deleteEvent);
router.post('/users/:userId/suspend', adminController.suspendUser);
router.post('/users/:userId/unsuspend', adminController.unsuspendUser);
router.post('/users/:userId/toggle-admin', adminController.toggleAdmin);
router.post('/users/:userId/toggle-premium', adminController.togglePremium);
router.post('/users/:userId/toggle-unlimited-vision', adminController.toggleUnlimitedVisionTokens);
router.post('/users/:userId/vision-quota/reset', adminController.resetUserVisionQuota);
router.put('/users/:userId/vision-quota', adminController.setUserVisionQuota);

// System settings (write — CSRF required)
router.put('/settings/:key', adminController.updateSetting);

module.exports = router;
