const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

function resolveQuery(client) {
  return client ? client.query.bind(client) : query;
}

function normalizeString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function isValidBox2d(box2d) {
  if (!Array.isArray(box2d) || box2d.length !== 4) return false;
  if (!box2d.every((value) => Number.isFinite(Number(value)))) return false;
  const [yMin, xMin, yMax, xMax] = box2d.map((value) => Number(value));
  return yMax > yMin && xMax > xMin;
}

function normalizeExtractionIndex(value) {
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

function resolveBox2d(region) {
  if (!region || typeof region !== 'object') return null;
  if (Array.isArray(region.box2d)) return region.box2d;
  if (Array.isArray(region.box_2d)) return region.box_2d;
  return null;
}

function mapRegionRow(row) {
  const mapped = rowToCamelCase(row);
  if (!mapped) return null;
  if (mapped.box2d == null && Array.isArray(mapped.box_2d)) {
    mapped.box2d = mapped.box_2d;
  }
  return mapped;
}

async function clearOwnerPhotoCropReferencesForScan(q, { userId, shelfId, scanPhotoId }) {
  // Deleting regions cascades to vision_item_crops. Clear dependent owner-photo pointers first
  // so ON DELETE SET NULL on user_collections.owner_photo_crop_id does not violate
  // owner_photo_reference_check (owner_photo_source='vision_crop' requires a crop id).
  await q(
    `WITH doomed_crops AS (
       SELECT vic.id
       FROM vision_item_crops vic
       JOIN vision_item_regions vir
         ON vir.id = vic.region_id
       WHERE vir.user_id = $1
         AND vir.shelf_id = $2
         AND vir.scan_photo_id = $3
     )
     UPDATE user_collections uc
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
     WHERE uc.user_id = $1
       AND uc.shelf_id = $2
       AND uc.owner_photo_crop_id IN (SELECT id FROM doomed_crops)`,
    [userId, shelfId, scanPhotoId],
  );
}

async function upsertRegionsForScan(
  { userId, shelfId, scanPhotoId, regions = [], replaceExisting = false },
  client = null,
) {
  if (!userId || !shelfId || !scanPhotoId || !Array.isArray(regions)) {
    return [];
  }

  const q = resolveQuery(client);
  if (replaceExisting) {
    try {
      await clearOwnerPhotoCropReferencesForScan(q, { userId, shelfId, scanPhotoId });
    } catch (err) {
      // Keep region replacement compatible with older schemas that may not yet have
      // vision_item_crops or owner-photo columns.
      if (err?.code !== '42P01' && err?.code !== '42703') {
        throw err;
      }
    }

    await q(
      `DELETE FROM vision_item_regions
       WHERE user_id = $1
         AND shelf_id = $2
         AND scan_photo_id = $3`,
      [userId, shelfId, scanPhotoId],
    );
  }

  if (regions.length === 0) {
    return [];
  }

  const saved = [];
  for (const region of regions) {
    const extractionIndex = normalizeExtractionIndex(region?.extractionIndex);
    const box2d = resolveBox2d(region);
    if (extractionIndex == null || !isValidBox2d(box2d)) continue;

    const confidenceValue = region?.confidence;
    const confidence = Number.isFinite(Number(confidenceValue)) ? Number(confidenceValue) : null;
    const result = await q(
      `INSERT INTO vision_item_regions (
         user_id, shelf_id, scan_photo_id, extraction_index,
         title, primary_creator, box_2d, confidence
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (scan_photo_id, extraction_index)
       DO UPDATE SET
         title = EXCLUDED.title,
         primary_creator = EXCLUDED.primary_creator,
         box_2d = EXCLUDED.box_2d,
         confidence = EXCLUDED.confidence
       RETURNING *`,
      [
        userId,
        shelfId,
        scanPhotoId,
        extractionIndex,
        normalizeString(region?.title || region?.name),
        normalizeString(region?.primaryCreator || region?.author),
        JSON.stringify(box2d.map((value) => Number(value))),
        confidence,
      ],
    );
    if (result.rows[0]) {
      saved.push(mapRegionRow(result.rows[0]));
    }
  }

  return saved;
}

async function linkCollectable({ scanPhotoId, extractionIndex, collectableId }, client = null) {
  if (!scanPhotoId || normalizeExtractionIndex(extractionIndex) == null || !collectableId) return null;
  const q = resolveQuery(client);
  const result = await q(
    `UPDATE vision_item_regions
     SET collectable_id = $1
     WHERE scan_photo_id = $2
       AND extraction_index = $3
     RETURNING *`,
    [collectableId, scanPhotoId, extractionIndex],
  );
  return result.rows[0] ? mapRegionRow(result.rows[0]) : null;
}

async function linkManual({ scanPhotoId, extractionIndex, manualId }, client = null) {
  if (!scanPhotoId || normalizeExtractionIndex(extractionIndex) == null || !manualId) return null;
  const q = resolveQuery(client);
  const result = await q(
    `UPDATE vision_item_regions
     SET manual_id = $1
     WHERE scan_photo_id = $2
       AND extraction_index = $3
     RETURNING *`,
    [manualId, scanPhotoId, extractionIndex],
  );
  return result.rows[0] ? mapRegionRow(result.rows[0]) : null;
}

async function linkCollectionItem({ scanPhotoId, extractionIndex, collectionItemId }, client = null) {
  if (!scanPhotoId || normalizeExtractionIndex(extractionIndex) == null || !collectionItemId) return null;
  const q = resolveQuery(client);
  const result = await q(
    `UPDATE vision_item_regions
     SET collection_item_id = $1
     WHERE scan_photo_id = $2
       AND extraction_index = $3
     RETURNING *`,
    [collectionItemId, scanPhotoId, extractionIndex],
  );
  return result.rows[0] ? mapRegionRow(result.rows[0]) : null;
}

async function clearCollectionItemLink({ scanPhotoId, extractionIndex }, client = null) {
  if (!scanPhotoId || normalizeExtractionIndex(extractionIndex) == null) return null;
  const q = resolveQuery(client);
  const result = await q(
    `UPDATE vision_item_regions
     SET collection_item_id = NULL
     WHERE scan_photo_id = $1
       AND extraction_index = $2
     RETURNING *`,
    [scanPhotoId, extractionIndex],
  );
  return result.rows[0] ? mapRegionRow(result.rows[0]) : null;
}

async function hasCollectionItemLinkForReference({
  scanPhotoId,
  collectableId = null,
  manualId = null,
}) {
  if (!scanPhotoId || (!collectableId && !manualId)) return false;
  const filters = ['scan_photo_id = $1', 'collection_item_id IS NOT NULL'];
  const params = [scanPhotoId];
  const refClauses = [];

  if (collectableId) {
    params.push(collectableId);
    refClauses.push(`collectable_id = $${params.length}`);
  }
  if (manualId) {
    params.push(manualId);
    refClauses.push(`manual_id = $${params.length}`);
  }
  if (!refClauses.length) return false;

  const result = await query(
    `SELECT 1
     FROM vision_item_regions
     WHERE ${filters.join(' AND ')}
       AND (${refClauses.join(' OR ')})
     LIMIT 1`,
    params,
  );
  return result.rows.length > 0;
}

async function listForScan({ userId, shelfId, scanPhotoId }) {
  if (!userId || !shelfId || !scanPhotoId) return [];
  const result = await query(
    `SELECT *
     FROM vision_item_regions
     WHERE user_id = $1
       AND shelf_id = $2
       AND scan_photo_id = $3
     ORDER BY extraction_index ASC`,
    [userId, shelfId, scanPhotoId],
  );
  return result.rows.map(mapRegionRow);
}

async function countForScan({ userId, shelfId, scanPhotoId }) {
  if (!userId || !shelfId || !scanPhotoId) return 0;
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM vision_item_regions
     WHERE user_id = $1
       AND shelf_id = $2
       AND scan_photo_id = $3`,
    [userId, shelfId, scanPhotoId],
  );
  return result.rows[0]?.count || 0;
}

async function getByIdForScan({ userId, shelfId, scanPhotoId, regionId }) {
  if (!userId || !shelfId || !scanPhotoId || !regionId) return null;
  const result = await query(
    `SELECT *
     FROM vision_item_regions
     WHERE user_id = $1
       AND shelf_id = $2
       AND scan_photo_id = $3
       AND id = $4
     LIMIT 1`,
    [userId, shelfId, scanPhotoId, regionId],
  );
  return result.rows[0] ? mapRegionRow(result.rows[0]) : null;
}

module.exports = {
  upsertRegionsForScan,
  linkCollectable,
  linkManual,
  linkCollectionItem,
  clearCollectionItemLink,
  hasCollectionItemLinkForReference,
  listForScan,
  countForScan,
  getByIdForScan,
  isValidBox2d,
  resolveBox2d,
};
