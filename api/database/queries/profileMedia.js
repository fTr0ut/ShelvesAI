/**
 * Profile Media database queries
 * Handles profile photos and avatars for users
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const fetch = require('node-fetch');
const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');
const s3 = require('../../services/s3');
const {
    validateImageBuffer,
    isAllowedImageMimeType,
    normalizeMimeType,
} = require('../../utils/imageValidation');

// SSRF protection: blocked IP ranges and hostnames
const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    'metadata.google.internal',
    'metadata.google',
    '169.254.169.254', // AWS/GCP metadata
]);

/**
 * Check if an IP address is in a private range
 */
function isPrivateIP(ip) {
    // IPv4 private ranges
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p))) return false;

    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (link-local, includes cloud metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0/8
    if (parts[0] === 0) return true;

    return false;
}

/**
 * Validate URL for SSRF protection
 */
function validateUrlForSSRF(urlString) {
    let parsed;
    try {
        parsed = new URL(urlString);
    } catch {
        throw new Error('Invalid URL format');
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only HTTP and HTTPS URLs are allowed');
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check blocked hostnames
    if (BLOCKED_HOSTNAMES.has(hostname)) {
        throw new Error('URL hostname is not allowed');
    }

    // Check if hostname looks like an IP address
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
        if (isPrivateIP(hostname)) {
            throw new Error('Private IP addresses are not allowed');
        }
    }

    return parsed;
}

// Media storage configuration - use same cache directory as server.js
const API_ROOT = path.resolve(__dirname, '..', '..');
const RAW_CACHE_ROOT = process.env.MEDIA_CACHE_DIR || process.env.COVER_CACHE_DIR || './cache';
const CACHE_ROOT = path.isAbsolute(RAW_CACHE_ROOT)
    ? RAW_CACHE_ROOT
    : path.resolve(API_ROOT, RAW_CACHE_ROOT);
const RAW_MAX_BYTES = parseInt(process.env.MEDIA_MAX_BYTES || '5242880', 10);
const MAX_PROFILE_IMAGE_BYTES =
    Number.isFinite(RAW_MAX_BYTES) && RAW_MAX_BYTES > 0 ? RAW_MAX_BYTES : 5242880;

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
 * Download image from URL and validate content type + image bytes.
 */
async function downloadImageFromUrl(url) {
    const response = await fetch(url, { timeout: 15000 });
    if (!response.ok) {
        throw new Error(`Failed to download from ${url}: ${response.status}`);
    }

    const headerMime = normalizeMimeType(response.headers.get('content-type') || '');
    if (headerMime && !isAllowedImageMimeType(headerMime)) {
        throw new Error('Remote URL did not return an allowed image type');
    }

    const contentLength = parseInt(response.headers.get('content-length') || '', 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_PROFILE_IMAGE_BYTES) {
        throw new Error(`Remote image exceeds ${MAX_PROFILE_IMAGE_BYTES} bytes`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_PROFILE_IMAGE_BYTES) {
        throw new Error(`Remote image exceeds ${MAX_PROFILE_IMAGE_BYTES} bytes`);
    }
    const validated = await validateImageBuffer(buffer);
    if (headerMime && headerMime !== validated.mime) {
        throw new Error('Remote image MIME mismatch');
    }

    return { buffer, contentType: validated.mime };
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

    // Clean up files from S3 or local filesystem
    const useS3 = s3.isEnabled();
    for (const row of result.rows) {
        if (row.local_path) {
            try {
                if (useS3) {
                    await s3.deleteObject(row.local_path);
                } else {
                    await fs.unlink(toAbsolutePath(row.local_path));
                }
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
    // SSRF protection: validate URL before fetching
    validateUrlForSSRF(sourceUrl);

    // Download and validate the image before storage.
    const downloaded = await downloadImageFromUrl(sourceUrl);
    const checksum = crypto.createHash('sha256').update(downloaded.buffer).digest('hex').slice(0, 16);
    const ext = extFromContentType(downloaded.contentType);
    const localPath = buildLocalPath({ userId, checksum, ext });

    const saveResult = await saveBuffer(downloaded.buffer, localPath, downloaded.contentType);

    // Create database record
    const media = await create({
        userId,
        kind: 'avatar',
        sourceUrl,
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

/**
 * Upload profile photo from buffer (multipart upload)
 */
async function uploadFromBuffer({ userId, buffer, contentType, originalFilename }) {
    const validated = await validateImageBuffer(buffer);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const ext = extFromContentType(validated.mime);
    const localPath = buildLocalPath({ userId, checksum, ext });

    const saveResult = await saveBuffer(buffer, localPath, validated.mime);

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
