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

async function upsertRegionsForScan(
  { userId, shelfId, scanPhotoId, regions = [], replaceExisting = false },
  client = null,
) {
  if (!userId || !shelfId || !scanPhotoId || !Array.isArray(regions)) {
    return [];
  }

  const q = resolveQuery(client);
  if (replaceExisting) {
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
  listForScan,
  countForScan,
  getByIdForScan,
  isValidBox2d,
  resolveBox2d,
};
