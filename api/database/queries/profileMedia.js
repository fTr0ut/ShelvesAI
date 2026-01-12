/**
 * Profile Media database queries
 * Handles profile photos and avatars for users
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

// Media storage configuration (reuse from media.js pattern)
const API_ROOT = path.resolve(__dirname, '..', '..');
const RAW_CACHE_ROOT = process.env.MEDIA_CACHE_PATH || './cache/media';
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
 * Build local path for profile photo
 */
function buildLocalPath({ userId, checksum, ext }) {
    const safeUserId = String(userId).replace(/[^a-zA-Z0-9-]/g, '_');
    const filename = `${checksum}${ext}`;
    return path.join('profiles', safeUserId, filename);
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
 * Check if file exists
 */
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Download image from URL and save locally
 */
async function downloadAndSave(url, localPath) {
    const absolutePath = toAbsolutePath(localPath);
    const dir = path.dirname(absolutePath);

    await fs.mkdir(dir, { recursive: true });

    const response = await fetch(url, { timeout: 15000 });
    if (!response.ok) {
        throw new Error(`Failed to download from ${url}: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    await fs.writeFile(absolutePath, buffer);

    return {
        sizeBytes: buffer.length,
        checksum,
        contentType,
    };
}

/**
 * Save uploaded buffer to local path
 */
async function saveBuffer(buffer, localPath, contentType) {
    const absolutePath = toAbsolutePath(localPath);
    const dir = path.dirname(absolutePath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(absolutePath, buffer);

    const checksum = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

    return {
        sizeBytes: buffer.length,
        checksum,
        contentType: contentType || 'image/jpeg',
    };
}

/**
 * Create profile media record
 */
async function create({ userId, kind = 'avatar', sourceUrl, localPath, contentType, sizeBytes, checksum }) {
    const result = await query(
        `INSERT INTO profile_media (user_id, kind, source_url, local_path, content_type, size_bytes, checksum)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [userId, kind, sourceUrl, localPath, contentType, sizeBytes, checksum]
    );
    return rowToCamelCase(result.rows[0]);
}

/**
 * Get profile media for a user
 */
async function getForUser(userId) {
    const result = await query(
        `SELECT * FROM profile_media WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Get profile media by ID
 */
async function getById(id) {
    const result = await query(
        `SELECT * FROM profile_media WHERE id = $1`,
        [id]
    );
    return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Delete old profile media for user (keeps the latest)
 */
async function deleteOldForUser(userId, keepId) {
    const result = await query(
        `DELETE FROM profile_media WHERE user_id = $1 AND id != $2 RETURNING local_path`,
        [userId, keepId]
    );

    // Clean up files
    for (const row of result.rows) {
        if (row.local_path) {
            try {
                await fs.unlink(toAbsolutePath(row.local_path));
            } catch {
                // Ignore file deletion errors
            }
        }
    }

    return result.rowCount;
}

/**
 * Upload profile photo from URL
 */
async function uploadFromUrl({ userId, sourceUrl }) {
    // Download the image
    const checksum = crypto.createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16);
    const ext = '.jpg'; // Will be updated after download
    const localPath = buildLocalPath({ userId, checksum, ext });

    const downloadResult = await downloadAndSave(sourceUrl, localPath);

    // Create database record
    const media = await create({
        userId,
        kind: 'avatar',
        sourceUrl,
        localPath,
        contentType: downloadResult.contentType,
        sizeBytes: downloadResult.sizeBytes,
        checksum: downloadResult.checksum,
    });

    // Update user's profile_media_id
    await query(
        `UPDATE users SET profile_media_id = $1 WHERE id = $2`,
        [media.id, userId]
    );

    // Clean up old profile media
    await deleteOldForUser(userId, media.id);

    return media;
}

/**
 * Upload profile photo from buffer (multipart upload)
 */
async function uploadFromBuffer({ userId, buffer, contentType, originalFilename }) {
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const ext = extFromContentType(contentType);
    const localPath = buildLocalPath({ userId, checksum, ext });

    const saveResult = await saveBuffer(buffer, localPath, contentType);

    // Create database record
    const media = await create({
        userId,
        kind: 'avatar',
        sourceUrl: originalFilename || null,
        localPath,
        contentType: saveResult.contentType,
        sizeBytes: saveResult.sizeBytes,
        checksum: saveResult.checksum,
    });

    // Update user's profile_media_id
    await query(
        `UPDATE users SET profile_media_id = $1 WHERE id = $2`,
        [media.id, userId]
    );

    // Clean up old profile media
    await deleteOldForUser(userId, media.id);

    return media;
}

module.exports = {
    create,
    getForUser,
    getById,
    deleteOldForUser,
    uploadFromUrl,
    uploadFromBuffer,
    toAbsolutePath,
    buildLocalPath,
};
