'use strict';

const {
  BOX_COORDINATE_MODES,
  normalizeVisionBox2d,
} = require('../utils/visionBox2d');

// ---------------------------------------------------------------------------
// Scout prompt builders
// ---------------------------------------------------------------------------

function buildScoutPrompt(shelfType) {
  const label = String(shelfType || 'items').trim().toLowerCase() || 'items';
  return `You are selecting one region-of-interest on a ${label} shelf photo.
Return ONLY a valid JSON object with this exact schema:
{"region_box_2d":[y_min,x_min,y_max,x_max],"confidence":number,"estimated_item_count":number,"has_more_than_ten":boolean,"full_image_estimated_item_count":number,"full_image_has_more_than_ten":boolean}

Rules:
- region_box_2d must be normalized to 0-1000 and tightly cover the visible shelf/item band where items should be detected.
- If no reliable region exists, return {"region_box_2d": null, "confidence": 0, "estimated_item_count": 0, "has_more_than_ten": false, "full_image_estimated_item_count": 0, "full_image_has_more_than_ten": false}.
- confidence must be a number between 0 and 1.
- estimated_item_count must be an integer >= 0.
- has_more_than_ten must be true only when estimated_item_count is strictly greater than 10.
- full_image_estimated_item_count must be an integer >= 0 for the ENTIRE image.
- full_image_has_more_than_ten must be true only when full_image_estimated_item_count is strictly greater than 10.
- No markdown fences. No extra keys.`;
}

function buildMultiRegionScoutPrompt(shelfType) {
  const label = String(shelfType || 'items').trim().toLowerCase() || 'items';
  return `You are identifying ALL distinct item regions on a ${label} shelf photo. Return the general regions where items are visible, even if the region may be larger than the item band. Each region should cover a distinct visible shelf/item band where items should be detected, and regions should not significantly overlap each other. We do not want to cut off the tops or edges of items.
Return ONLY a valid JSON object with this exact schema:
{"full_image_estimated_item_count":number,"full_image_has_more_than_ten":boolean,"regions":[{"region_box_2d":[y_min,x_min,y_max,x_max],"confidence":number,"estimated_item_count":number,"has_more_than_ten":boolean}]}

Rules:
- full_image_estimated_item_count must be an integer >= 0 for the ENTIRE image.
- full_image_has_more_than_ten must be true only when full_image_estimated_item_count is strictly greater than 10.
- Each region_box_2d must be normalized to 0-1000 and tightly cover a distinct visible shelf/item band where items should be detected.
- Each region's confidence must be a number between 0 and 1.
- Each region's estimated_item_count must be an integer >= 0 for that region only.
- Each region's has_more_than_ten must be true only when that region's estimated_item_count is strictly greater than 10.
- If no reliable regions exist, return {"full_image_estimated_item_count":0,"full_image_has_more_than_ten":false,"regions":[]}.
- Regions should not significantly overlap each other.
- No markdown fences. No extra keys.`;
}

// ---------------------------------------------------------------------------
// JSON repair / extraction
// ---------------------------------------------------------------------------

function extractJsonObject(text) {
  let clean = String(text || '').replace(/```json/g, '').replace(/```/g, '').trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(clean);
}

// ---------------------------------------------------------------------------
// Shared field parsers
// ---------------------------------------------------------------------------

function parseNonNegativeInt(value) {
  const numeric = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(numeric) || numeric < 0) return null;
  return numeric;
}

function parseConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

function parseBox2d(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== 4) return null;
  return normalizeVisionBox2d(value, { mode: BOX_COORDINATE_MODES.NORMALIZED });
}

// ---------------------------------------------------------------------------
// Single-region response parser
// ---------------------------------------------------------------------------

function parseScoutResponse(responseText) {
  const parsed = extractJsonObject(responseText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Scout response must be a JSON object.');
  }

  const regionBox2d = parseBox2d(parsed.region_box_2d ?? parsed.regionBox2d ?? null);
  const confidence = parseConfidence(parsed.confidence);
  const estimatedItemCount = parseNonNegativeInt(
    parsed.estimated_item_count ?? parsed.estimatedItemCount,
  );
  const hasMoreThanTen = estimatedItemCount != null ? estimatedItemCount > 10 : null;
  const fullImageEstimatedItemCount = parseNonNegativeInt(
    parsed.full_image_estimated_item_count ?? parsed.fullImageEstimatedItemCount,
  );
  const fullImageHasMoreThanTen = fullImageEstimatedItemCount != null
    ? fullImageEstimatedItemCount > 10
    : null;

  if (
    estimatedItemCount == null
    || fullImageEstimatedItemCount == null
  ) {
    throw new Error(
      'Scout response must include estimated_item_count and full_image_estimated_item_count as integers >= 0.',
    );
  }

  return {
    regionBox2d,
    confidence,
    estimatedItemCount,
    hasMoreThanTen,
    fullImageEstimatedItemCount,
    fullImageHasMoreThanTen,
    rawText: responseText,
  };
}

// ---------------------------------------------------------------------------
// Multi-region response parser
// ---------------------------------------------------------------------------

function parseMultiRegionScoutResponse(responseText) {
  const parsed = extractJsonObject(responseText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Multi-region scout response must be a JSON object.');
  }

  const rawRegions = parsed.regions;
  if (!Array.isArray(rawRegions)) {
    throw new Error('Multi-region scout response must include a regions array.');
  }

  const fullImageEstimatedItemCount = parseNonNegativeInt(
    parsed.full_image_estimated_item_count ?? parsed.fullImageEstimatedItemCount,
  );
  const fullImageHasMoreThanTen = fullImageEstimatedItemCount != null
    ? fullImageEstimatedItemCount > 10
    : null;

  if (fullImageEstimatedItemCount == null) {
    throw new Error(
      'Multi-region scout response must include full_image_estimated_item_count as an integer >= 0.',
    );
  }

  const regions = [];
  for (const entry of rawRegions) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const regionBox2d = parseBox2d(entry.region_box_2d ?? entry.regionBox2d ?? null);
    const confidence = parseConfidence(entry.confidence);
    const estimatedItemCount = parseNonNegativeInt(
      entry.estimated_item_count ?? entry.estimatedItemCount,
    );
    const hasMoreThanTen = estimatedItemCount != null ? estimatedItemCount > 10 : null;

    if (regionBox2d == null || estimatedItemCount == null) continue;

    regions.push({
      regionBox2d,
      confidence,
      estimatedItemCount,
      hasMoreThanTen,
    });
  }

  const totalEstimatedItemCount = regions.reduce(
    (sum, entry) => sum + entry.estimatedItemCount,
    0,
  );
  const hasAnyRegionMoreThanTen = regions.some((entry) => entry.hasMoreThanTen === true);

  return {
    estimatedItemCount: totalEstimatedItemCount,
    hasMoreThanTen: hasAnyRegionMoreThanTen,
    fullImageEstimatedItemCount,
    fullImageHasMoreThanTen,
    regions,
    rawText: responseText,
  };
}

module.exports = {
  buildScoutPrompt,
  buildMultiRegionScoutPrompt,
  parseScoutResponse,
  parseMultiRegionScoutResponse,
};
