const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');
const s3 = require('../../services/s3');
const { prepareShelfUploadImage } = require('../../services/shelfImageUpload');

const API_ROOT = path.resolve(__dirname, '..', '..');
const RAW_PRIVATE_ROOT =
  process.env.SHELF_PHOTO_PRIVATE_STORAGE_DIR
  || process.env.VISION_PRIVATE_STORAGE_DIR
  || path.join(API_ROOT, 'private-storage');
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

function toAbsolutePath(storageKey) {
  const parts = String(storageKey || '').split('/').filter(Boolean);
  return path.join(PRIVATE_ROOT, ...parts);
}

function buildStorageKey({ userId, shelfId, checksum, contentType }) {
  const safeUserId = normalizePathSegment(userId);
  const safeShelfId = normalizePathSegment(shelfId);
  const safeChecksum = normalizePathSegment(checksum).slice(0, 16) || 'photo';
  const ext = extFromContentType(contentType);
  return path.posix.join('shelf-photos', safeUserId, safeShelfId, `${safeChecksum}${ext}`);
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

async function deleteUploadedAsset(storageProvider, storageKey) {
  if (!storageProvider || !storageKey) return;
  try {
    if (storageProvider === 's3') {
      await s3.deleteObject(storageKey);
      return;
    }
    if (storageProvider === 'local') {
      await fs.unlink(toAbsolutePath(storageKey));
      return;
    }
  } catch (_err) {
    // best-effort cleanup
  }
}

async function getByShelfId({ shelfId }) {
  if (!shelfId) return null;
  const result = await query(
    `SELECT id, owner_id, name, type,
            photo_storage_provider, photo_storage_key, photo_content_type,
            photo_size_bytes, photo_width, photo_height, photo_updated_at
     FROM shelves
     WHERE id = $1
     LIMIT 1`,
    [shelfId],
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function uploadPhotoForShelf({
  shelfId,
  userId,
  buffer,
  contentType,
}) {
  if (!shelfId || !userId || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Invalid shelf photo payload');
  }

  const existing = await query(
    `SELECT id, owner_id, photo_storage_provider, photo_storage_key
     FROM shelves
     WHERE id = $1 AND owner_id = $2
     LIMIT 1`,
    [shelfId, userId],
  );
  if (!existing.rows[0]) {
    throw new Error('Shelf not found');
  }

  const prepared = await prepareShelfUploadImage(buffer);
  const checksum = crypto.createHash('sha256').update(prepared.buffer).digest('hex');
  const finalContentType = prepared.mime || contentType || 'image/jpeg';
  const storageKey = buildStorageKey({
    userId,
    shelfId,
    checksum,
    contentType: finalContentType,
  });
  const storageProvider = await saveBuffer(prepared.buffer, storageKey, finalContentType);

  const result = await query(
    `UPDATE shelves
     SET photo_storage_provider = $1,
         photo_storage_key = $2,
         photo_content_type = $3,
         photo_size_bytes = $4,
         photo_width = $5,
         photo_height = $6,
         photo_updated_at = NOW()
     WHERE id = $7 AND owner_id = $8
     RETURNING *`,
    [
      storageProvider,
      storageKey,
      finalContentType,
      prepared.sizeBytes,
      prepared.width ?? null,
      prepared.height ?? null,
      shelfId,
      userId,
    ],
  );

  const updated = result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
  if (!updated) {
    await deleteUploadedAsset(storageProvider, storageKey);
    throw new Error('Shelf not found');
  }

  const previous = rowToCamelCase(existing.rows[0]);
  if (
    previous.photoStorageKey
    && (previous.photoStorageKey !== storageKey || previous.photoStorageProvider !== storageProvider)
  ) {
    await deleteUploadedAsset(previous.photoStorageProvider, previous.photoStorageKey);
  }

  return updated;
}

async function clearPhotoForShelf({ shelfId, userId }) {
  if (!shelfId || !userId) return null;

  const existing = await query(
    `SELECT id, photo_storage_provider, photo_storage_key
     FROM shelves
     WHERE id = $1 AND owner_id = $2
     LIMIT 1`,
    [shelfId, userId],
  );
  if (!existing.rows[0]) return null;

  const previous = rowToCamelCase(existing.rows[0]);
  const result = await query(
    `UPDATE shelves
     SET photo_storage_provider = NULL,
         photo_storage_key = NULL,
         photo_content_type = NULL,
         photo_size_bytes = NULL,
         photo_width = NULL,
         photo_height = NULL,
         photo_updated_at = NULL
     WHERE id = $1 AND owner_id = $2
     RETURNING *`,
    [shelfId, userId],
  );

  const updated = result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
  if (previous.photoStorageKey) {
    await deleteUploadedAsset(previous.photoStorageProvider, previous.photoStorageKey);
  }

  return updated;
}

async function loadPhotoBuffer(shelfRecord) {
  if (!shelfRecord?.photoStorageProvider || !shelfRecord?.photoStorageKey) {
    throw new Error('Shelf photo is not set');
  }

  if (shelfRecord.photoStorageProvider === 's3') {
    const remote = await s3.getObjectBuffer(shelfRecord.photoStorageKey);
    return {
      buffer: remote.buffer,
      contentType: remote.contentType || shelfRecord.photoContentType || 'image/jpeg',
      contentLength: remote.contentLength ?? remote.buffer.length,
    };
  }

  if (shelfRecord.photoStorageProvider === 'local') {
    const buffer = await fs.readFile(toAbsolutePath(shelfRecord.photoStorageKey));
    return {
      buffer,
      contentType: shelfRecord.photoContentType || 'image/jpeg',
      contentLength: buffer.length,
    };
  }

  throw new Error(`Unsupported shelf photo storage provider: ${shelfRecord.photoStorageProvider}`);
}

module.exports = {
  getByShelfId,
  uploadPhotoForShelf,
  clearPhotoForShelf,
  loadPhotoBuffer,
  buildStorageKey,
  toAbsolutePath,
};
