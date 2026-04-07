const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');
const logger = require('../../logger');
const { prepareShelfUploadImage } = require('../../services/shelfImageUpload');
const visionItemCropsQueries = require('./visionItemCrops');
const s3 = require('../../services/s3');
const {
  renderOwnerPhotoThumbnail,
  resolveThumbnailBoxForOwnerPhoto,
} = require('../../services/ownerPhotoThumbnail');

const API_ROOT = path.resolve(__dirname, '..', '..');
const RAW_PRIVATE_ROOT = process.env.VISION_PRIVATE_STORAGE_DIR || path.join(API_ROOT, 'private-storage');
const PRIVATE_ROOT = path.isAbsolute(RAW_PRIVATE_ROOT)
  ? RAW_PRIVATE_ROOT
  : path.resolve(API_ROOT, RAW_PRIVATE_ROOT);
const OWNER_PHOTO_DEBUG_ENABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.OWNER_PHOTO_DEBUG_ENABLED || '').trim().toLowerCase());
const parsedOwnerPhotoDebugItemId = Number.parseInt(String(process.env.OWNER_PHOTO_DEBUG_ITEM_ID || ''), 10);
const OWNER_PHOTO_DEBUG_ITEM_ID = Number.isInteger(parsedOwnerPhotoDebugItemId) && parsedOwnerPhotoDebugItemId > 0
  ? parsedOwnerPhotoDebugItemId
  : null;

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

function shouldLogOwnerPhotoDebug(itemId = null) {
  if (!OWNER_PHOTO_DEBUG_ENABLED) return false;
  if (!OWNER_PHOTO_DEBUG_ITEM_ID) return true;
  return Number(itemId) === Number(OWNER_PHOTO_DEBUG_ITEM_ID);
}

function sanitizeThumbnailBoxForLog(box) {
  if (!box || typeof box !== 'object') return null;
  const rounded = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.round(numeric * 1000000) / 1000000;
  };
  return {
    x: rounded(box.x),
    y: rounded(box.y),
    width: rounded(box.width),
    height: rounded(box.height),
  };
}

function logOwnerPhotoQueryDebug(stage, payload = {}) {
  if (!OWNER_PHOTO_DEBUG_ENABLED) return;
  logger.info(`[OwnerPhotoDebug.query] ${stage}`, payload);
}

function extFromContentType(contentType) {
  const base = (contentType || '').split(';')[0].trim().toLowerCase();
  return EXT_MAP.get(base) || '.jpg';
}

function toAbsolutePath(storageKey) {
  const parts = String(storageKey || '').split('/').filter(Boolean);
  return path.join(PRIVATE_ROOT, ...parts);
}

function buildUploadStorageKey({ userId, shelfId, itemId, checksum, contentType }) {
  const safeUserId = normalizePathSegment(userId);
  const safeShelfId = normalizePathSegment(shelfId);
  const safeItemId = normalizePathSegment(itemId);
  const safeChecksum = normalizePathSegment(checksum).slice(0, 16) || 'photo';
  const ext = extFromContentType(contentType);
  return path.posix.join('owner-photos', safeUserId, safeShelfId, safeItemId, `${safeChecksum}${ext}`);
}

function buildThumbnailStorageKey({ userId, shelfId, itemId, checksum, contentType }) {
  const safeUserId = normalizePathSegment(userId);
  const safeShelfId = normalizePathSegment(shelfId);
  const safeItemId = normalizePathSegment(itemId);
  const safeChecksum = normalizePathSegment(checksum).slice(0, 16) || 'thumb';
  const ext = extFromContentType(contentType);
  return path.posix.join('owner-photos-thumbs', safeUserId, safeShelfId, safeItemId, `${safeChecksum}${ext}`);
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
  if (storageProvider === 's3') {
    await s3.deleteObject(storageKey);
    return;
  }
  if (storageProvider === 'local') {
    try {
      await fs.unlink(toAbsolutePath(storageKey));
    } catch (err) {
      // best-effort cleanup
    }
  }
}

async function getByCollectionItem({ itemId, shelfId }) {
  if (!itemId || !shelfId) return null;
  const result = await query(
    `SELECT uc.id, uc.user_id, uc.shelf_id,
            uc.collectable_id, uc.manual_id,
            uc.owner_photo_source, uc.owner_photo_crop_id,
            uc.owner_photo_storage_provider, uc.owner_photo_storage_key,
            uc.owner_photo_content_type, uc.owner_photo_size_bytes,
            uc.owner_photo_width, uc.owner_photo_height,
            uc.owner_photo_thumb_storage_provider, uc.owner_photo_thumb_storage_key,
            uc.owner_photo_thumb_content_type, uc.owner_photo_thumb_size_bytes,
            uc.owner_photo_thumb_width, uc.owner_photo_thumb_height,
            uc.owner_photo_thumb_box, uc.owner_photo_thumb_updated_at,
            uc.owner_photo_visible, uc.owner_photo_updated_at,
            u.show_personal_photos
     FROM user_collections uc
     JOIN users u ON u.id = uc.user_id
     WHERE uc.id = $1
       AND uc.shelf_id = $2
     LIMIT 1`,
    [itemId, shelfId],
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function persistOwnerPhotoThumbnail({
  itemRecord,
  sourceBuffer,
  box = null,
}) {
  if (!itemRecord?.id || !itemRecord?.userId || !itemRecord?.shelfId) {
    throw new Error('Invalid collection item for thumbnail persistence');
  }
  const normalizedBox = resolveThumbnailBoxForOwnerPhoto({
    ownerPhotoSource: itemRecord.ownerPhotoSource,
    box,
  });
  const thumbnail = await renderOwnerPhotoThumbnail({
    sourceBuffer,
    box: normalizedBox,
  });
  const checksum = crypto.createHash('sha256').update(thumbnail.buffer).digest('hex');
  const storageKey = buildThumbnailStorageKey({
    userId: itemRecord.userId,
    shelfId: itemRecord.shelfId,
    itemId: itemRecord.id,
    checksum,
    contentType: thumbnail.contentType,
  });
  const storageProvider = await saveBuffer(thumbnail.buffer, storageKey, thumbnail.contentType);

  const previousProvider = itemRecord.ownerPhotoThumbStorageProvider || null;
  const previousKey = itemRecord.ownerPhotoThumbStorageKey || null;

  const result = await query(
    `UPDATE user_collections
     SET owner_photo_thumb_storage_provider = $1,
         owner_photo_thumb_storage_key = $2,
         owner_photo_thumb_content_type = $3,
         owner_photo_thumb_size_bytes = $4,
         owner_photo_thumb_width = $5,
         owner_photo_thumb_height = $6,
         owner_photo_thumb_box = $7::jsonb,
         owner_photo_thumb_updated_at = NOW()
     WHERE id = $8
       AND user_id = $9
       AND shelf_id = $10
     RETURNING *`,
    [
      storageProvider,
      storageKey,
      thumbnail.contentType,
      thumbnail.buffer.length,
      thumbnail.width,
      thumbnail.height,
      JSON.stringify(thumbnail.box),
      itemRecord.id,
      itemRecord.userId,
      itemRecord.shelfId,
    ],
  );

  if (
    previousKey
    && (previousKey !== storageKey || previousProvider !== storageProvider)
  ) {
    await deleteUploadedAsset(previousProvider, previousKey);
  }

  return {
    item: result.rows[0] ? rowToCamelCase(result.rows[0]) : null,
    thumbnail,
  };
}

async function attachVisionCropToItem({
  itemId,
  userId,
  shelfId,
  cropId,
  contentType,
  sizeBytes,
  width,
  height,
}) {
  if (!itemId || !userId || !shelfId || !cropId) return null;
  const existing = await getByCollectionItem({ itemId, shelfId });
  const previousThumbProvider = existing?.ownerPhotoThumbStorageProvider || null;
  const previousThumbKey = existing?.ownerPhotoThumbStorageKey || null;

  const result = await query(
    `UPDATE user_collections
     SET owner_photo_source = 'vision_crop',
         owner_photo_crop_id = $1,
         owner_photo_storage_provider = NULL,
         owner_photo_storage_key = NULL,
         owner_photo_content_type = COALESCE($2, owner_photo_content_type),
         owner_photo_size_bytes = COALESCE($3, owner_photo_size_bytes),
         owner_photo_width = COALESCE($4, owner_photo_width),
         owner_photo_height = COALESCE($5, owner_photo_height),
         owner_photo_thumb_storage_provider = NULL,
         owner_photo_thumb_storage_key = NULL,
         owner_photo_thumb_content_type = NULL,
         owner_photo_thumb_size_bytes = NULL,
         owner_photo_thumb_width = NULL,
         owner_photo_thumb_height = NULL,
         owner_photo_thumb_box = NULL,
         owner_photo_thumb_updated_at = NULL,
         owner_photo_visible = COALESCE((SELECT show_personal_photos FROM users WHERE id = $7), TRUE),
         owner_photo_updated_at = NOW()
     WHERE id = $6
       AND user_id = $7
       AND shelf_id = $8
       AND (owner_photo_source IS NULL OR owner_photo_source = 'vision_crop')
     RETURNING *`,
    [cropId, contentType || null, sizeBytes ?? null, width ?? null, height ?? null, itemId, userId, shelfId],
  );
  const updated = result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
  if (previousThumbKey) {
    await deleteUploadedAsset(previousThumbProvider, previousThumbKey);
  }

  if (!updated) return updated;

  try {
    const crop = await visionItemCropsQueries.getByIdForUser({
      id: cropId,
      userId,
      shelfId,
    });
    if (crop) {
      const payload = await visionItemCropsQueries.loadImageBuffer(crop);
      const withThumb = await persistOwnerPhotoThumbnail({
        itemRecord: updated,
        sourceBuffer: payload.buffer,
        box: null,
      });
      return withThumb.item || updated;
    }
  } catch (err) {
    // Thumbnail generation is best-effort for crop attachments.
  }

  return updated;
}

async function uploadOwnerPhotoForItem({
  itemId,
  userId,
  shelfId,
  buffer,
  contentType,
}) {
  if (!itemId || !userId || !shelfId || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Invalid owner photo payload');
  }

  const existing = await query(
    `SELECT owner_photo_source, owner_photo_storage_provider, owner_photo_storage_key,
            owner_photo_thumb_storage_provider, owner_photo_thumb_storage_key, owner_photo_thumb_box
     FROM user_collections
     WHERE id = $1 AND user_id = $2 AND shelf_id = $3
     LIMIT 1`,
    [itemId, userId, shelfId],
  );
  if (!existing.rows[0]) {
    throw new Error('Shelf item not found');
  }

  const prepared = await prepareShelfUploadImage(buffer);
  const checksum = crypto.createHash('sha256').update(prepared.buffer).digest('hex');
  const finalContentType = prepared.mime || contentType || 'image/jpeg';
  const storageKey = buildUploadStorageKey({
    userId,
    shelfId,
    itemId,
    checksum,
    contentType: finalContentType,
  });
  const storageProvider = await saveBuffer(prepared.buffer, storageKey, finalContentType);

  const result = await query(
    `UPDATE user_collections
     SET owner_photo_source = 'upload',
         owner_photo_crop_id = NULL,
         owner_photo_storage_provider = $1,
         owner_photo_storage_key = $2,
         owner_photo_content_type = $3,
         owner_photo_size_bytes = $4,
         owner_photo_width = $5,
         owner_photo_height = $6,
         owner_photo_thumb_storage_provider = NULL,
         owner_photo_thumb_storage_key = NULL,
         owner_photo_thumb_content_type = NULL,
         owner_photo_thumb_size_bytes = NULL,
         owner_photo_thumb_width = NULL,
         owner_photo_thumb_height = NULL,
         owner_photo_thumb_box = NULL,
         owner_photo_thumb_updated_at = NULL,
         owner_photo_visible = COALESCE((SELECT show_personal_photos FROM users WHERE id = $8), TRUE),
         owner_photo_updated_at = NOW()
     WHERE id = $7
       AND user_id = $8
       AND shelf_id = $9
     RETURNING *`,
    [
      storageProvider,
      storageKey,
      finalContentType,
      prepared.sizeBytes,
      prepared.width || null,
      prepared.height || null,
      itemId,
      userId,
      shelfId,
    ],
  );
  const updated = result.rows[0] ? rowToCamelCase(result.rows[0]) : null;

  const previous = rowToCamelCase(existing.rows[0]);
  if (
    previous?.ownerPhotoSource === 'upload'
    && previous?.ownerPhotoStorageKey
    && (previous.ownerPhotoStorageKey !== storageKey || previous.ownerPhotoStorageProvider !== storageProvider)
  ) {
    await deleteUploadedAsset(previous.ownerPhotoStorageProvider, previous.ownerPhotoStorageKey);
  }

  if (previous?.ownerPhotoThumbStorageKey) {
    await deleteUploadedAsset(previous.ownerPhotoThumbStorageProvider, previous.ownerPhotoThumbStorageKey);
  }

  if (updated) {
    const withThumb = await persistOwnerPhotoThumbnail({
      itemRecord: {
        ...updated,
        userId,
        shelfId,
      },
      sourceBuffer: prepared.buffer,
      box: null,
    });
    return withThumb.item || updated;
  }

  return updated;
}

async function setOwnerPhotoVisibility({ itemId, userId, shelfId, visible }) {
  if (!itemId || !userId || !shelfId) return null;
  const result = await query(
    `UPDATE user_collections
     SET owner_photo_visible = $1
     WHERE id = $2
       AND user_id = $3
       AND shelf_id = $4
     RETURNING *`,
    [!!visible, itemId, userId, shelfId],
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function clearOwnerPhotoForItem({ itemId, userId, shelfId }) {
  if (!itemId || !userId || !shelfId) return null;

  const existing = await query(
    `SELECT owner_photo_source, owner_photo_storage_provider, owner_photo_storage_key,
            owner_photo_thumb_storage_provider, owner_photo_thumb_storage_key
     FROM user_collections
     WHERE id = $1 AND user_id = $2 AND shelf_id = $3
     LIMIT 1`,
    [itemId, userId, shelfId],
  );
  if (!existing.rows[0]) {
    return null;
  }

  const previous = rowToCamelCase(existing.rows[0]);
  const result = await query(
    `UPDATE user_collections
     SET owner_photo_source = NULL,
         owner_photo_crop_id = NULL,
         owner_photo_storage_provider = NULL,
         owner_photo_storage_key = NULL,
         owner_photo_content_type = NULL,
         owner_photo_size_bytes = NULL,
         owner_photo_width = NULL,
         owner_photo_height = NULL,
         owner_photo_thumb_storage_provider = NULL,
         owner_photo_thumb_storage_key = NULL,
         owner_photo_thumb_content_type = NULL,
         owner_photo_thumb_size_bytes = NULL,
         owner_photo_thumb_width = NULL,
         owner_photo_thumb_height = NULL,
         owner_photo_thumb_box = NULL,
         owner_photo_thumb_updated_at = NULL,
         owner_photo_updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
       AND shelf_id = $3
     RETURNING *`,
    [itemId, userId, shelfId],
  );
  const updated = result.rows[0] ? rowToCamelCase(result.rows[0]) : null;

  if (previous?.ownerPhotoSource === 'upload' && previous?.ownerPhotoStorageKey) {
    await deleteUploadedAsset(previous.ownerPhotoStorageProvider, previous.ownerPhotoStorageKey);
  }
  if (previous?.ownerPhotoThumbStorageKey) {
    await deleteUploadedAsset(previous.ownerPhotoThumbStorageProvider, previous.ownerPhotoThumbStorageKey);
  }

  return updated;
}

async function loadOwnerPhotoBuffer(photoRecord) {
  if (!photoRecord?.ownerPhotoSource) {
    throw new Error('Owner photo is not set');
  }

  if (shouldLogOwnerPhotoDebug(photoRecord.id)) {
    logOwnerPhotoQueryDebug('loadOwnerPhotoBuffer.begin', {
      itemId: photoRecord.id,
      shelfId: photoRecord.shelfId,
      userId: photoRecord.userId,
      source: photoRecord.ownerPhotoSource,
      storageProvider: photoRecord.ownerPhotoStorageProvider || null,
      hasStorageKey: !!photoRecord.ownerPhotoStorageKey,
    });
  }

  if (photoRecord.ownerPhotoSource === 'vision_crop') {
    const crop = await visionItemCropsQueries.getByIdForUser({
      id: photoRecord.ownerPhotoCropId,
      userId: photoRecord.userId,
      shelfId: photoRecord.shelfId,
    });
    if (!crop) {
      throw new Error('Owner photo crop not found');
    }
    if (shouldLogOwnerPhotoDebug(photoRecord.id)) {
      logOwnerPhotoQueryDebug('loadOwnerPhotoBuffer.visionCrop', {
        itemId: photoRecord.id,
        cropId: photoRecord.ownerPhotoCropId || null,
      });
    }
    return visionItemCropsQueries.loadImageBuffer(crop);
  }

  if (photoRecord.ownerPhotoSource === 'upload') {
    const storageProvider = photoRecord.ownerPhotoStorageProvider;
    const storageKey = photoRecord.ownerPhotoStorageKey;
    if (!storageProvider || !storageKey) {
      throw new Error('Owner photo upload metadata is incomplete');
    }
    if (storageProvider === 's3') {
      const remote = await s3.getObjectBuffer(storageKey);
      if (shouldLogOwnerPhotoDebug(photoRecord.id)) {
        logOwnerPhotoQueryDebug('loadOwnerPhotoBuffer.upload.s3', {
          itemId: photoRecord.id,
          storageKey,
          contentLength: remote.contentLength ?? remote.buffer?.length ?? null,
          contentType: remote.contentType || photoRecord.ownerPhotoContentType || 'image/jpeg',
        });
      }
      return {
        buffer: remote.buffer,
        contentType: remote.contentType || photoRecord.ownerPhotoContentType || 'image/jpeg',
        contentLength: remote.contentLength ?? remote.buffer.length,
      };
    }
    if (storageProvider === 'local') {
      const buffer = await fs.readFile(toAbsolutePath(storageKey));
      if (shouldLogOwnerPhotoDebug(photoRecord.id)) {
        logOwnerPhotoQueryDebug('loadOwnerPhotoBuffer.upload.local', {
          itemId: photoRecord.id,
          storageKey,
          contentLength: buffer.length,
          contentType: photoRecord.ownerPhotoContentType || 'image/jpeg',
        });
      }
      return {
        buffer,
        contentType: photoRecord.ownerPhotoContentType || 'image/jpeg',
        contentLength: buffer.length,
      };
    }
    throw new Error(`Unsupported owner photo storage provider: ${storageProvider}`);
  }

  throw new Error(`Unsupported owner photo source: ${photoRecord.ownerPhotoSource}`);
}

async function loadOwnerPhotoThumbnailBuffer(photoRecord) {
  if (!photoRecord?.ownerPhotoSource) {
    throw new Error('Owner photo is not set');
  }

  if (shouldLogOwnerPhotoDebug(photoRecord.id)) {
    logOwnerPhotoQueryDebug('loadOwnerPhotoThumbnailBuffer.begin', {
      itemId: photoRecord.id,
      shelfId: photoRecord.shelfId,
      userId: photoRecord.userId,
      source: photoRecord.ownerPhotoSource,
      thumbProvider: photoRecord.ownerPhotoThumbStorageProvider || null,
      thumbHasKey: !!photoRecord.ownerPhotoThumbStorageKey,
      thumbnailBox: sanitizeThumbnailBoxForLog(photoRecord.ownerPhotoThumbBox),
    });
  }

  if (!photoRecord?.ownerPhotoThumbStorageKey || !photoRecord?.ownerPhotoThumbStorageProvider) {
    if (shouldLogOwnerPhotoDebug(photoRecord.id)) {
      logOwnerPhotoQueryDebug('loadOwnerPhotoThumbnailBuffer.missingThumbStorage', {
        itemId: photoRecord.id,
        reason: 'missing thumb storage metadata',
        thumbnailBox: sanitizeThumbnailBoxForLog(photoRecord.ownerPhotoThumbBox),
      });
    }
    const generated = await upsertOwnerPhotoThumbnailForItem({
      itemId: photoRecord.id,
      userId: photoRecord.userId,
      shelfId: photoRecord.shelfId,
      box: photoRecord.ownerPhotoThumbBox || null,
    });
    if (!generated?.ownerPhotoThumbStorageKey || !generated?.ownerPhotoThumbStorageProvider) {
      throw new Error('Unable to generate owner photo thumbnail');
    }
    if (shouldLogOwnerPhotoDebug(photoRecord.id)) {
      logOwnerPhotoQueryDebug('loadOwnerPhotoThumbnailBuffer.generated', {
        itemId: photoRecord.id,
        thumbProvider: generated.ownerPhotoThumbStorageProvider || null,
        thumbHasKey: !!generated.ownerPhotoThumbStorageKey,
        thumbnailBox: sanitizeThumbnailBoxForLog(generated.ownerPhotoThumbBox),
      });
    }
    return loadOwnerPhotoThumbnailBuffer(generated);
  }

  if (photoRecord.ownerPhotoThumbStorageProvider === 's3') {
    const remote = await s3.getObjectBuffer(photoRecord.ownerPhotoThumbStorageKey);
    if (shouldLogOwnerPhotoDebug(photoRecord.id)) {
      logOwnerPhotoQueryDebug('loadOwnerPhotoThumbnailBuffer.s3', {
        itemId: photoRecord.id,
        storageKey: photoRecord.ownerPhotoThumbStorageKey,
        contentLength: remote.contentLength ?? remote.buffer?.length ?? null,
        contentType: remote.contentType || photoRecord.ownerPhotoThumbContentType || 'image/jpeg',
      });
    }
    return {
      buffer: remote.buffer,
      contentType: remote.contentType || photoRecord.ownerPhotoThumbContentType || 'image/jpeg',
      contentLength: remote.contentLength ?? remote.buffer.length,
    };
  }

  if (photoRecord.ownerPhotoThumbStorageProvider === 'local') {
    const buffer = await fs.readFile(toAbsolutePath(photoRecord.ownerPhotoThumbStorageKey));
    if (shouldLogOwnerPhotoDebug(photoRecord.id)) {
      logOwnerPhotoQueryDebug('loadOwnerPhotoThumbnailBuffer.local', {
        itemId: photoRecord.id,
        storageKey: photoRecord.ownerPhotoThumbStorageKey,
        contentLength: buffer.length,
        contentType: photoRecord.ownerPhotoThumbContentType || 'image/jpeg',
      });
    }
    return {
      buffer,
      contentType: photoRecord.ownerPhotoThumbContentType || 'image/jpeg',
      contentLength: buffer.length,
    };
  }

  throw new Error(`Unsupported owner photo thumbnail storage provider: ${photoRecord.ownerPhotoThumbStorageProvider}`);
}

async function upsertOwnerPhotoThumbnailForItem({
  itemId,
  userId,
  shelfId,
  box = null,
}) {
  const item = await getByCollectionItem({ itemId, shelfId });
  if (!item || item.userId !== userId) {
    throw new Error('Shelf item not found');
  }
  if (!item.ownerPhotoSource) {
    throw new Error('Owner photo is not set');
  }

  if (shouldLogOwnerPhotoDebug(itemId)) {
    logOwnerPhotoQueryDebug('upsertOwnerPhotoThumbnailForItem.begin', {
      itemId,
      shelfId,
      userId,
      source: item.ownerPhotoSource,
      inputBox: sanitizeThumbnailBoxForLog(box),
      existingBox: sanitizeThumbnailBoxForLog(item.ownerPhotoThumbBox),
    });
  }

  const source = await loadOwnerPhotoBuffer(item);
  const result = await persistOwnerPhotoThumbnail({
    itemRecord: item,
    sourceBuffer: source.buffer,
    box,
  });

  if (shouldLogOwnerPhotoDebug(itemId)) {
    logOwnerPhotoQueryDebug('upsertOwnerPhotoThumbnailForItem.done', {
      itemId,
      shelfId,
      thumbProvider: result?.item?.ownerPhotoThumbStorageProvider || item.ownerPhotoThumbStorageProvider || null,
      thumbHasKey: !!(result?.item?.ownerPhotoThumbStorageKey || item.ownerPhotoThumbStorageKey),
      persistedBox: sanitizeThumbnailBoxForLog(result?.thumbnail?.box || result?.item?.ownerPhotoThumbBox || null),
      thumbSizeBytes: result?.item?.ownerPhotoThumbSizeBytes ?? null,
      thumbDimensions: {
        width: result?.item?.ownerPhotoThumbWidth ?? null,
        height: result?.item?.ownerPhotoThumbHeight ?? null,
      },
    });
  }

  return result.item || item;
}

module.exports = {
  getByCollectionItem,
  attachVisionCropToItem,
  uploadOwnerPhotoForItem,
  clearOwnerPhotoForItem,
  setOwnerPhotoVisibility,
  loadOwnerPhotoBuffer,
  loadOwnerPhotoThumbnailBuffer,
  upsertOwnerPhotoThumbnailForItem,
  buildUploadStorageKey,
  buildThumbnailStorageKey,
  toAbsolutePath,
};
