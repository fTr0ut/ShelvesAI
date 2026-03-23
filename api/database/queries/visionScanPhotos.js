const fs = require('fs/promises');
const path = require('path');
const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');
const s3 = require('../../services/s3');
const { validateImageBuffer } = require('../../utils/imageValidation');

const API_ROOT = path.resolve(__dirname, '..', '..');
const RAW_PRIVATE_ROOT = process.env.VISION_PRIVATE_STORAGE_DIR || path.join(API_ROOT, 'private-storage');
const PRIVATE_ROOT = path.isAbsolute(RAW_PRIVATE_ROOT)
  ? RAW_PRIVATE_ROOT
  : path.resolve(API_ROOT, RAW_PRIVATE_ROOT);

const EXT_MAP = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return fallback;
}

const VISION_SCAN_MAX_DIMENSION = parsePositiveInteger(process.env.VISION_SCAN_MAX_DIMENSION, 8192);
const VISION_SCAN_MAX_PIXELS = parsePositiveInteger(process.env.VISION_SCAN_MAX_PIXELS, 40000000);

function normalizePathSegment(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function extFromContentType(contentType) {
  const base = (contentType || '').split(';')[0].trim().toLowerCase();
  return EXT_MAP.get(base) || '.jpg';
}

function buildStorageKey({ userId, shelfId, imageSha256, contentType }) {
  const safeUserId = normalizePathSegment(userId);
  const safeShelfId = normalizePathSegment(shelfId);
  const ext = extFromContentType(contentType);
  const hashPrefix = String(imageSha256 || '').slice(0, 16) || 'scan';
  return path.posix.join('vision-scans', safeUserId, safeShelfId, `${hashPrefix}${ext}`);
}

function toAbsolutePath(storageKey) {
  const parts = String(storageKey || '').split('/').filter(Boolean);
  return path.join(PRIVATE_ROOT, ...parts);
}

async function saveBuffer(buffer, storageKey, contentType) {
  if (s3.isEnabled()) {
    await s3.uploadPrivateBuffer(buffer, storageKey, contentType);
    return 's3';
  }

  const absolutePath = toAbsolutePath(storageKey);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);
  return 'local';
}

async function upsertFromBuffer({ userId, shelfId, imageSha256, buffer, contentType = null }) {
  if (!userId || !shelfId || !imageSha256 || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Invalid scan photo payload');
  }

  const validated = await validateImageBuffer(buffer, {
    maxDimension: VISION_SCAN_MAX_DIMENSION,
    maxPixels: VISION_SCAN_MAX_PIXELS,
  });
  const finalContentType = validated.mime || contentType || 'image/jpeg';
  const storageKey = buildStorageKey({
    userId,
    shelfId,
    imageSha256,
    contentType: finalContentType,
  });
  const storageProvider = await saveBuffer(buffer, storageKey, finalContentType);

  const result = await query(
    `INSERT INTO vision_scan_photos (
       user_id, shelf_id, image_sha256, storage_provider, storage_key,
       content_type, size_bytes, width, height
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, shelf_id, image_sha256)
     DO UPDATE SET
       storage_provider = EXCLUDED.storage_provider,
       storage_key = EXCLUDED.storage_key,
       content_type = EXCLUDED.content_type,
       size_bytes = EXCLUDED.size_bytes,
       width = EXCLUDED.width,
       height = EXCLUDED.height
     RETURNING *`,
    [
      userId,
      shelfId,
      imageSha256,
      storageProvider,
      storageKey,
      finalContentType,
      buffer.length,
      validated.width || null,
      validated.height || null,
    ],
  );

  return rowToCamelCase(result.rows[0]);
}

async function getByIdForUser({ id, userId, shelfId }) {
  if (!id || !userId || !shelfId) return null;
  const result = await query(
    `SELECT *
     FROM vision_scan_photos
     WHERE id = $1
       AND user_id = $2
       AND shelf_id = $3
     LIMIT 1`,
    [id, userId, shelfId],
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function getByHash({ userId, shelfId, imageSha256 }) {
  if (!userId || !shelfId || !imageSha256) return null;
  const result = await query(
    `SELECT *
     FROM vision_scan_photos
     WHERE user_id = $1
       AND shelf_id = $2
       AND image_sha256 = $3
     LIMIT 1`,
    [userId, shelfId, imageSha256],
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function loadImageBuffer(scanPhoto) {
  if (!scanPhoto?.storageKey) {
    throw new Error('Scan photo storage key is required');
  }

  if (scanPhoto.storageProvider === 's3') {
    const remote = await s3.getObjectBuffer(scanPhoto.storageKey);
    return {
      buffer: remote.buffer,
      contentType: remote.contentType || scanPhoto.contentType || 'image/jpeg',
      contentLength: remote.contentLength ?? remote.buffer.length,
    };
  }

  if (scanPhoto.storageProvider === 'local') {
    const absolutePath = toAbsolutePath(scanPhoto.storageKey);
    const buffer = await fs.readFile(absolutePath);
    return {
      buffer,
      contentType: scanPhoto.contentType || 'image/jpeg',
      contentLength: buffer.length,
    };
  }

  throw new Error(`Unsupported scan photo storage provider: ${scanPhoto.storageProvider}`);
}

module.exports = {
  upsertFromBuffer,
  getByIdForUser,
  getByHash,
  loadImageBuffer,
  buildStorageKey,
  toAbsolutePath,
};
