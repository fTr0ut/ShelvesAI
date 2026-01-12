/**
 * Profile Routes
 * Handles profile viewing, editing, and photo uploads
 */

const express = require('express');
const multer = require('multer');
const { auth, optionalAuth } = require('../middleware/auth');
const profileController = require('../controllers/profileController');

const router = express.Router();

// Configure multer for photo uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    },
});

// Authenticated routes
router.get('/', auth, profileController.getMyProfile);
router.put('/', auth, profileController.updateMyProfile);
router.post('/photo', auth, upload.single('photo'), profileController.uploadPhoto);

// Public/optional auth routes (must come after specific routes to avoid conflicts)
router.get('/:username', optionalAuth, profileController.getPublicProfile);
router.get('/:username/shelves', optionalAuth, profileController.getProfileShelves);

module.exports = router;
