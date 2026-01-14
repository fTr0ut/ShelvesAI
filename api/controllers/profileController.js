/**
 * Profile Controller
 * Handles profile viewing, editing, and photo uploads
 */

const { query } = require('../database/pg');
const usersQueries = require('../database/queries/users');
const shelvesQueries = require('../database/queries/shelves');
const profileMediaQueries = require('../database/queries/profileMedia');
const { rowToCamelCase } = require('../database/queries/utils');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * GET /profile - Get current user's full profile
 */
async function getMyProfile(req, res) {
    try {
        const profile = await usersQueries.getFullProfile(req.user.id);

        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        // Get shelf count
        const shelves = await shelvesQueries.listForUser(req.user.id);

        const response = rowToCamelCase(profile);
        response.shelfCount = shelves.length;
        response.isOwner = true;

        res.json({ profile: response });
    } catch (err) {
        console.error('getMyProfile error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * PUT /profile - Update current user's profile
 */
async function updateMyProfile(req, res) {
    try {
        const body = req.body || {};
        const updates = {};
        const allowedFields = [
            'first_name', 'last_name', 'bio', 'city', 'state',
            'country', 'is_private', 'phone_number'
        ];

        // Map camelCase to snake_case for the update
        const fieldMap = {
            firstName: 'first_name',
            lastName: 'last_name',
            phoneNumber: 'phone_number',
            isPrivate: 'is_private',
        };

        if (Object.prototype.hasOwnProperty.call(body, 'email')) {
            const normalizedEmail = normalizeEmail(body.email);
            if (!normalizedEmail || !emailPattern.test(normalizedEmail)) {
                return res.status(400).json({ error: 'Invalid email address' });
            }
            const existing = await usersQueries.findByEmail(normalizedEmail);
            if (existing && existing.id !== req.user.id) {
                return res.status(409).json({ error: 'Email taken' });
            }
            updates.email = normalizedEmail;
        }

        for (const [key, value] of Object.entries(body)) {
            if (key === 'email') continue;
            const snakeKey = fieldMap[key] || key;
            if (allowedFields.includes(snakeKey)) {
                updates[snakeKey] = value;
            }
        }

        const updatedUser = await usersQueries.updateProfile(req.user.id, updates);

        if (!updatedUser) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.json({ profile: rowToCamelCase(updatedUser) });
    } catch (err) {
        console.error('updateMyProfile error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * POST /profile/photo - Upload profile photo
 * Expects multipart form with 'photo' field or JSON with 'url' field
 */
async function uploadPhoto(req, res) {
    try {
        let media;

        // Check if multipart upload
        if (req.file) {
            media = await profileMediaQueries.uploadFromBuffer({
                userId: req.user.id,
                buffer: req.file.buffer,
                contentType: req.file.mimetype,
                originalFilename: req.file.originalname,
            });
        }
        // Check if URL upload
        else if (req.body.url) {
            media = await profileMediaQueries.uploadFromUrl({
                userId: req.user.id,
                sourceUrl: req.body.url,
            });
        } else {
            return res.status(400).json({ error: 'No photo provided' });
        }

        res.json({
            success: true,
            media: {
                id: media.id,
                localPath: media.localPath,
            }
        });
    } catch (err) {
        console.error('uploadPhoto error:', err);
        res.status(500).json({ error: 'Failed to upload photo' });
    }
}

/**
 * GET /profile/:username - Get public profile by username
 */
async function getPublicProfile(req, res) {
    try {
        const { username } = req.params;
        const viewerId = req.user?.id || null;

        const profile = await usersQueries.getPublicProfile(username, viewerId);

        if (!profile) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ profile });
    } catch (err) {
        console.error('getPublicProfile error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /profile/:username/shelves - Get visible shelves for a user
 */
async function getProfileShelves(req, res) {
    try {
        const { username } = req.params;
        const viewerId = req.user?.id || null;

        // First get the user
        const user = await usersQueries.findByUsername(username);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check privacy
        if (user.is_private && viewerId !== user.id) {
            // Check if friends
            const friendCheck = await query(
                `SELECT 1 FROM friendships 
                 WHERE status = 'accepted' 
                 AND ((requester_id = $1 AND addressee_id = $2)
                      OR (requester_id = $2 AND addressee_id = $1))`,
                [user.id, viewerId]
            );

            if (friendCheck.rows.length === 0) {
                return res.json({ shelves: [], message: 'This profile is private' });
            }
        }

        const shelves = await shelvesQueries.listVisibleForUser(user.id, viewerId);

        res.json({ shelves });
    } catch (err) {
        console.error('getProfileShelves error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

module.exports = {
    getMyProfile,
    updateMyProfile,
    uploadPhoto,
    getPublicProfile,
    getProfileShelves,
};
