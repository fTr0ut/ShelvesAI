/**
 * Profile Routes
 * Handles profile viewing, editing, and photo uploads
 */

const express = require('express');
const multer = require('multer');
const { auth, optionalAuth } = require('../middleware/auth');
const { validateStringLengths } = require('../middleware/validate');
const profileController = require('../controllers/profileController');
const { isAllowedImageMimeType } = require('../utils/imageValidation');

const router = express.Router();

// Configure multer for photo uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (isAllowedImageMimeType(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG, PNG, and WEBP images are allowed'));
        }
    },
});

// Authenticated routes
router.get('/', auth, profileController.getMyProfile);
router.put('/', auth, validateStringLengths({ bio: 5000, first_name: 500, last_name: 500, city: 500, state: 500, country: 500 }), profileController.updateMyProfile);
router.post('/photo', auth, upload.single('photo'), profileController.uploadPhoto);

// Public/optional auth routes (must come after specific routes to avoid conflicts)
router.get('/:username', optionalAuth, profileController.getPublicProfile);
router.get('/:username/shelves', optionalAuth, profileController.getProfileShelves);

module.exports = router;
