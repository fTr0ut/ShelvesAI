/**
 * Manual Media database queries
 * Handles cover images for user_manuals entries
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');
const s3 = require('../../services/s3');

// Media storage configuration - use same cache directory as server.js
const API_ROOT = path.resolve(__dirname, '..', '..');
const RAW_CACHE_ROOT = process.env.MEDIA_CACHE_DIR || process.env.COVER_CACHE_DIR || './cache';
const CACHE_ROOT = path.isAbsolute(RAW_CACHE_ROOT)
    ? RAW_CACHE_ROOT
    : path.resolve(API_ROOT, RAW_CACHE_ROOT);

const EXT_MAP = new Map([
    ['image/jpeg', '.jpg'],
    ['image/jpg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
]);

/**
 * Build local path for manual cover image
 * Path format: manuals/{userId}/{manualId}/{checksum}.{ext}
 */
function buildLocalPath({ userId, manualId, checksum, ext }) {
    const safeUserId = String(userId).replace(/[^a-zA-Z0-9-]/g, '_');
    const safeManualId = String(manualId).replace(/[^a-zA-Z0-9-]/g, '_');
    const filename = `${checksum}${ext}`;
    return path.join('manuals', safeUserId, safeManualId, filename);
}

/**
 * Convert local path to absolute path
 */
function toAbsolutePath(localPath) {
    return path.join(CACHE_ROOT, localPath);
}

/**
 * Get extension from content type
 */
function extFromContentType(contentType) {
    const base = (contentType || '').split(';')[0].trim().toLowerCase();
    return EXT_MAP.get(base) || '.jpg';
}

/**
 * Save uploaded buffer to S3 or local filesystem
 */
async function saveBuffer(buffer, localPath, contentType) {
    const finalContentType = contentType || 'image/jpeg';

    // Upload to S3 if configured, otherwise fall back to local filesystem
    if (s3.isEnabled()) {
        await s3.uploadBuffer(buffer, localPath, finalContentType);
    } else {
        const absolutePath = toAbsolutePath(localPath);
        const dir = path.dirname(absolutePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(absolutePath, buffer);
    }

    const checksum = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

    return {
        sizeBytes: buffer.length,
        checksum,
        contentType: finalContentType,
    };
}

/**
 * Delete old cover media file from S3 or local filesystem
 */
async function deleteOldCover(localPath) {
    if (!localPath) return;

    try {
        if (s3.isEnabled()) {
            await s3.deleteObject(localPath);
        } else {
            await fs.unlink(toAbsolutePath(localPath));
        }
    } catch (err) {
        // Ignore file deletion errors
        console.warn('[manualMedia] Failed to delete old cover:', err.message);
    }
}

/**
 * Upload cover image from buffer for a manual item
 * @param {Object} options - Upload options
 * @param {number} options.userId - User ID
 * @param {number} options.manualId - Manual item ID
 * @param {Buffer} options.buffer - Image buffer
 * @param {string} options.contentType - MIME type
 * @returns {Promise<Object>} Updated manual with cover path
 */
async function uploadFromBuffer({ userId, manualId, buffer, contentType }) {
    // Generate checksum for filename
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const ext = extFromContentType(contentType);
    const localPath = buildLocalPath({ userId, manualId, checksum, ext });

    // Get existing cover path for cleanup
    const existingResult = await query(
        `SELECT cover_media_path FROM user_manuals WHERE id = $1`,
        [manualId]
    );
    const oldPath = existingResult.rows[0]?.cover_media_path;

    // Save new file
    const saveResult = await saveBuffer(buffer, localPath, contentType);

    // Update database
    const updateResult = await query(
        `UPDATE user_manuals
         SET cover_media_path = $1, cover_content_type = $2
         WHERE id = $3
         RETURNING *`,
        [localPath, saveResult.contentType, manualId]
    );

    if (!updateResult.rows.length) {
        throw new Error('Manual item not found');
    }

    // Clean up old cover if path is different
    if (oldPath && oldPath !== localPath) {
        await deleteOldCover(oldPath);
    }

    return rowToCamelCase(updateResult.rows[0]);
}

/**
 * Delete cover media for a manual item
 * @param {number} manualId - Manual item ID
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteForManual(manualId) {
    // Get existing cover path
    const existingResult = await query(
        `SELECT cover_media_path FROM user_manuals WHERE id = $1`,
        [manualId]
    );

    const oldPath = existingResult.rows[0]?.cover_media_path;

    if (!oldPath) {
        return false;
    }

    // Clear database fields
    await query(
        `UPDATE user_manuals
         SET cover_media_path = NULL, cover_content_type = NULL
         WHERE id = $1`,
        [manualId]
    );

    // Delete file
    await deleteOldCover(oldPath);

    return true;
}

/**
 * Get manual item with cover info
 * @param {number} manualId - Manual item ID
 * @returns {Promise<Object|null>} Manual item or null
 */
async function getById(manualId) {
    const result = await query(
        `SELECT * FROM user_manuals WHERE id = $1`,
        [manualId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

module.exports = {
    uploadFromBuffer,
    deleteForManual,
    deleteOldCover,
    getById,
    buildLocalPath,
    toAbsolutePath,
    extFromContentType,
};
