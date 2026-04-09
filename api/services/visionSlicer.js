'use strict';

const sharp = require('sharp');
const {
  BOX_COORDINATE_MODES,
  BOX_SCALE,
  normalizeVisionBox2d,
} = require('../utils/visionBox2d');

const DEFAULT_SLICE_COUNT = 4;
const DEFAULT_SLICE_OVERLAP_RATIO = 0.12;
const DEFAULT_DEDUPE_IOU_THRESHOLD = 0.4;

// ---------------------------------------------------------------------------
// Slice rect computation
// ---------------------------------------------------------------------------

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toDimension(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric);
}

function computeSliceRects(
  imageWidth,
  imageHeight,
  {
    sliceCount = DEFAULT_SLICE_COUNT,
    overlapRatio = DEFAULT_SLICE_OVERLAP_RATIO,
  } = {},
) {
  const width = toDimension(imageWidth);
  const height = toDimension(imageHeight);
  const resolvedSliceCount = Number.isInteger(sliceCount) && sliceCount > 0
    ? sliceCount
    : DEFAULT_SLICE_COUNT;
  const resolvedOverlap = Number.isFinite(Number(overlapRatio))
    ? Math.max(0, Math.min(0.49, Number(overlapRatio)))
    : DEFAULT_SLICE_OVERLAP_RATIO;

  if (!width || !height) {
    throw new Error('Slice computation requires valid image dimensions.');
  }

  const nominalWidth = width / resolvedSliceCount;
  const overlapPx = Math.round(nominalWidth * resolvedOverlap);
  const rects = [];

  for (let sliceId = 0; sliceId < resolvedSliceCount; sliceId += 1) {
    const startRaw = Math.floor(sliceId * nominalWidth - (sliceId > 0 ? overlapPx : 0));
    const endRaw = Math.ceil((sliceId + 1) * nominalWidth + (sliceId < resolvedSliceCount - 1 ? overlapPx : 0));
    const left = clamp(startRaw, 0, width - 1);
    const right = clamp(endRaw, left + 1, width);
    rects.push({
      sliceId,
      left,
      top: 0,
      width: right - left,
      height,
    });
  }

  return rects;
}

// ---------------------------------------------------------------------------
// Buffer extraction
// ---------------------------------------------------------------------------

async function extractSliceBuffers(imageBuffer, sliceRects) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error('extractSliceBuffers requires a non-empty image buffer.');
  }
  if (!Array.isArray(sliceRects) || sliceRects.length === 0) {
    return [];
  }

  const source = sharp(imageBuffer, { failOnError: false });
  const results = [];

  for (const rect of sliceRects) {
    const buffer = await source
      .clone()
      .extract({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    results.push({
      sliceId: rect.sliceId,
      buffer,
      contentType: 'image/jpeg',
      width: rect.width,
      height: rect.height,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Coordinate remapping: slice-local → full-image
// ---------------------------------------------------------------------------

function remapBox2dFromSlice(box2d, sliceRect, fullImageWidth, fullImageHeight) {
  const normalized = normalizeVisionBox2d(box2d, {
    mode: BOX_COORDINATE_MODES.NORMALIZED,
  });
  if (!normalized) return null;

  const left = Number(sliceRect?.left);
  const top = Number(sliceRect?.top);
  const sliceWidth = Number(sliceRect?.width);
  const sliceHeight = Number(sliceRect?.height);
  const fullW = Number(fullImageWidth);
  const fullH = Number(fullImageHeight);

  if (
    !Number.isFinite(left)
    || !Number.isFinite(top)
    || !Number.isFinite(sliceWidth)
    || !Number.isFinite(sliceHeight)
    || !Number.isFinite(fullW)
    || !Number.isFinite(fullH)
    || sliceWidth <= 0
    || sliceHeight <= 0
    || fullW <= 0
    || fullH <= 0
  ) {
    return null;
  }

  const [yMin, xMin, yMax, xMax] = normalized;
  const toPixels = (value, size) => (value / BOX_SCALE) * size;

  return normalizeVisionBox2d([
    ((top + toPixels(yMin, sliceHeight)) / fullH) * BOX_SCALE,
    ((left + toPixels(xMin, sliceWidth)) / fullW) * BOX_SCALE,
    ((top + toPixels(yMax, sliceHeight)) / fullH) * BOX_SCALE,
    ((left + toPixels(xMax, sliceWidth)) / fullW) * BOX_SCALE,
  ], {
    mode: BOX_COORDINATE_MODES.NORMALIZED,
  });
}

// ---------------------------------------------------------------------------
// IoU-based deduplication
// ---------------------------------------------------------------------------

function computeIou(a, b) {
  const boxA = normalizeVisionBox2d(a, { mode: BOX_COORDINATE_MODES.NORMALIZED });
  const boxB = normalizeVisionBox2d(b, { mode: BOX_COORDINATE_MODES.NORMALIZED });
  if (!boxA || !boxB) return 0;

  const [aY1, aX1, aY2, aX2] = boxA;
  const [bY1, bX1, bY2, bX2] = boxB;
  const intersectionWidth = Math.max(0, Math.min(aX2, bX2) - Math.max(aX1, bX1));
  const intersectionHeight = Math.max(0, Math.min(aY2, bY2) - Math.max(aY1, bY1));
  if (intersectionWidth <= 0 || intersectionHeight <= 0) return 0;

  const intersectionArea = intersectionWidth * intersectionHeight;
  const areaA = Math.max(0, (aX2 - aX1) * (aY2 - aY1));
  const areaB = Math.max(0, (bX2 - bX1) * (bY2 - bY1));
  const unionArea = areaA + areaB - intersectionArea;
  if (unionArea <= 0) return 0;
  return intersectionArea / unionArea;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildTextKey(entry) {
  const title = normalizeText(entry?.title || entry?.label || entry?.name);
  if (!title) return null;
  const author = normalizeText(entry?.author || entry?.primaryCreator);
  return `${title}|${author}`;
}

function canonicalizeTitle(value) {
  return normalizeText(value)
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s+/g, '');
}

function canonicalizeAuthor(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function buildCanonicalTextKey(entry) {
  const title = canonicalizeTitle(entry?.title || entry?.label || entry?.name);
  if (!title) return null;
  const author = canonicalizeAuthor(entry?.author || entry?.primaryCreator);
  return `${title}|${author}`;
}

function readConfidence(entry) {
  const numeric = Number(entry?.confidence);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readArea(box2d) {
  const normalized = normalizeVisionBox2d(box2d, {
    mode: BOX_COORDINATE_MODES.NORMALIZED,
  });
  if (!normalized) return 0;
  const [yMin, xMin, yMax, xMax] = normalized;
  return Math.max(0, (yMax - yMin) * (xMax - xMin));
}

function deduplicateSliceDetections(
  detections = [],
  {
    iouThreshold = DEFAULT_DEDUPE_IOU_THRESHOLD,
  } = {},
) {
  const resolvedThreshold = Number.isFinite(Number(iouThreshold))
    ? Math.max(0, Math.min(1, Number(iouThreshold)))
    : DEFAULT_DEDUPE_IOU_THRESHOLD;

  const deduped = [];

  for (const candidate of detections) {
    const candidateTextKey = buildTextKey(candidate);
    const candidateBox = candidate?.box_2d || candidate?.box2d;

    if (
      !candidateTextKey
      || !Array.isArray(candidateBox)
      || candidateBox.length !== 4
    ) {
      deduped.push(candidate);
      continue;
    }

    let duplicateIndex = -1;
    let bestIou = -1;

    const candidateCanonicalKey = buildCanonicalTextKey(candidate);

    for (let i = 0; i < deduped.length; i += 1) {
      const existing = deduped[i];
      const existingTextKey = buildTextKey(existing);

      // Try strict text-key match first, then fall back to canonical
      let textMatch = false;
      if (existingTextKey && existingTextKey === candidateTextKey) {
        textMatch = true;
      } else if (candidateCanonicalKey) {
        const existingCanonicalKey = buildCanonicalTextKey(existing);
        if (existingCanonicalKey && existingCanonicalKey === candidateCanonicalKey) {
          textMatch = true;
        }
      }
      if (!textMatch) continue;

      const existingBox = existing?.box_2d || existing?.box2d;
      if (!Array.isArray(existingBox) || existingBox.length !== 4) continue;

      const iou = computeIou(existingBox, candidateBox);
      if (iou >= resolvedThreshold && iou > bestIou) {
        duplicateIndex = i;
        bestIou = iou;
      }
    }

    if (duplicateIndex < 0) {
      deduped.push(candidate);
      continue;
    }

    const existing = deduped[duplicateIndex];
    const existingConfidence = readConfidence(existing);
    const candidateConfidence = readConfidence(candidate);
    const existingArea = readArea(existing?.box_2d || existing?.box2d);
    const candidateArea = readArea(candidateBox);
    const candidateWins = (
      candidateConfidence > existingConfidence
      || (candidateConfidence === existingConfidence && candidateArea > existingArea)
    );

    if (candidateWins) {
      deduped[duplicateIndex] = candidate;
    }
  }

  return {
    detections: deduped,
    dedupedCount: Math.max(0, detections.length - deduped.length),
  };
}

module.exports = {
  DEFAULT_SLICE_COUNT,
  DEFAULT_SLICE_OVERLAP_RATIO,
  DEFAULT_DEDUPE_IOU_THRESHOLD,
  computeSliceRects,
  extractSliceBuffers,
  remapBox2dFromSlice,
  computeIou,
  deduplicateSliceDetections,
};
