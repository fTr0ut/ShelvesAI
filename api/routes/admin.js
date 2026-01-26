const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const adminController = require('../controllers/adminController');

// All admin routes require authentication and admin privileges
router.use(auth);
router.use(requireAdmin);

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
