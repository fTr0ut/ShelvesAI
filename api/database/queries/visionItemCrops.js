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

function normalizePathSegment(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function extFromContentType(contentType) {
  const base = (contentType || '').split(';')[0].trim().toLowerCase();
  return EXT_MAP.get(base) || '.jpg';
}

function buildStorageKey({ userId, shelfId, scanPhotoId, regionId, contentType }) {
  const safeUserId = normalizePathSegment(userId);
  const safeShelfId = normalizePathSegment(shelfId);
  const safeScanPhotoId = normalizePathSegment(scanPhotoId);
  const safeRegionId = normalizePathSegment(regionId);
  const ext = extFromContentType(contentType);
  return path.posix.join('vision-crops', safeUserId, safeShelfId, safeScanPhotoId, `${safeRegionId}${ext}`);
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

async function upsertFromBuffer({
  userId,
  shelfId,
  scanPhotoId,
  regionId,
  buffer,
  contentType = 'image/jpeg',
}) {
  if (!userId || !shelfId || !scanPhotoId || !regionId || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Invalid vision crop payload');
  }

  const validated = await validateImageBuffer(buffer);
  const finalContentType = validated.mime || contentType || 'image/jpeg';
  const storageKey = buildStorageKey({
    userId,
    shelfId,
    scanPhotoId,
    regionId,
    contentType: finalContentType,
  });
  const storageProvider = await saveBuffer(buffer, storageKey, finalContentType);

  const result = await query(
    `INSERT INTO vision_item_crops (
       user_id, shelf_id, scan_photo_id, region_id,
       storage_provider, storage_key, content_type, size_bytes, width, height
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (region_id)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       shelf_id = EXCLUDED.shelf_id,
       scan_photo_id = EXCLUDED.scan_photo_id,
       storage_provider = EXCLUDED.storage_provider,
       storage_key = EXCLUDED.storage_key,
       content_type = EXCLUDED.content_type,
       size_bytes = EXCLUDED.size_bytes,
       width = EXCLUDED.width,
       height = EXCLUDED.height,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      shelfId,
      scanPhotoId,
      regionId,
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

async function getByRegionIdForUser({ userId, shelfId, scanPhotoId, regionId }) {
  if (!userId || !shelfId || !scanPhotoId || !regionId) return null;
  const result = await query(
    `SELECT *
     FROM vision_item_crops
     WHERE user_id = $1
       AND shelf_id = $2
       AND scan_photo_id = $3
       AND region_id = $4
     LIMIT 1`,
    [userId, shelfId, scanPhotoId, regionId],
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function listForScan({ userId, shelfId, scanPhotoId }) {
  if (!userId || !shelfId || !scanPhotoId) return [];
  const result = await query(
    `SELECT *
     FROM vision_item_crops
     WHERE user_id = $1
       AND shelf_id = $2
       AND scan_photo_id = $3
     ORDER BY region_id ASC`,
    [userId, shelfId, scanPhotoId],
  );
  return result.rows.map(rowToCamelCase);
}

async function getByIdForUser({ id, userId, shelfId }) {
  if (!id || !userId || !shelfId) return null;
  const result = await query(
    `SELECT *
     FROM vision_item_crops
     WHERE id = $1
       AND user_id = $2
       AND shelf_id = $3
     LIMIT 1`,
    [id, userId, shelfId],
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function loadImageBuffer(crop) {
  if (!crop?.storageKey) {
    throw new Error('Vision crop storage key is required');
  }

  if (crop.storageProvider === 's3') {
    const remote = await s3.getObjectBuffer(crop.storageKey);
    return {
      buffer: remote.buffer,
      contentType: remote.contentType || crop.contentType || 'image/jpeg',
      contentLength: remote.contentLength ?? remote.buffer.length,
    };
  }

  if (crop.storageProvider === 'local') {
    const absolutePath = toAbsolutePath(crop.storageKey);
    const buffer = await fs.readFile(absolutePath);
    return {
      buffer,
      contentType: crop.contentType || 'image/jpeg',
      contentLength: buffer.length,
    };
  }

  throw new Error(`Unsupported vision crop storage provider: ${crop.storageProvider}`);
}

module.exports = {
  upsertFromBuffer,
  getByRegionIdForUser,
  getByIdForUser,
  listForScan,
  loadImageBuffer,
  buildStorageKey,
  toAbsolutePath,
};
