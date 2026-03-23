const sharp = require('sharp');

const BOX_SCALE = 1000;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDimension(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric);
}

function normalizeBox2d(box2d) {
  if (!Array.isArray(box2d) || box2d.length !== 4) return null;
  const parsed = box2d.map((value) => Number(value));
  if (!parsed.every((value) => Number.isFinite(value))) return null;

  const [yMinRaw, xMinRaw, yMaxRaw, xMaxRaw] = parsed;
  const yMin = clamp(yMinRaw, 0, BOX_SCALE);
  const xMin = clamp(xMinRaw, 0, BOX_SCALE);
  const yMax = clamp(yMaxRaw, 0, BOX_SCALE);
  const xMax = clamp(xMaxRaw, 0, BOX_SCALE);

  if (yMax <= yMin || xMax <= xMin) return null;
  return [yMin, xMin, yMax, xMax];
}

function computeCropRect(box2d, imageWidth, imageHeight) {
  const normalized = normalizeBox2d(box2d);
  const width = normalizeDimension(imageWidth);
  const height = normalizeDimension(imageHeight);
  if (!normalized || !width || !height) return null;

  const [yMin, xMin, yMax, xMax] = normalized;

  const left = clamp(Math.floor((xMin / BOX_SCALE) * width), 0, width - 1);
  const top = clamp(Math.floor((yMin / BOX_SCALE) * height), 0, height - 1);
  const right = clamp(Math.ceil((xMax / BOX_SCALE) * width), left + 1, width);
  const bottom = clamp(Math.ceil((yMax / BOX_SCALE) * height), top + 1, height);

  const cropWidth = right - left;
  const cropHeight = bottom - top;
  if (cropWidth <= 0 || cropHeight <= 0) return null;

  return {
    left,
    top,
    width: cropWidth,
    height: cropHeight,
  };
}

async function extractRegionCrop({
  imageBuffer,
  box2d,
  imageWidth = null,
  imageHeight = null,
  jpegQuality = 82,
}) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error('Scan photo image buffer is empty');
  }

  const source = sharp(imageBuffer, { failOnError: false });
  const metadata = await source.metadata();
  const width = normalizeDimension(imageWidth) || normalizeDimension(metadata?.width);
  const height = normalizeDimension(imageHeight) || normalizeDimension(metadata?.height);

  if (!width || !height) {
    throw new Error('Unable to determine scan photo dimensions for crop extraction');
  }

  const rect = computeCropRect(box2d, width, height);
  if (!rect) {
    throw new Error('Unable to compute crop rectangle from region box_2d');
  }

  const cropBuffer = await source
    .extract(rect)
    .jpeg({ quality: jpegQuality, mozjpeg: true })
    .toBuffer();

  return {
    buffer: cropBuffer,
    contentType: 'image/jpeg',
    width: rect.width,
    height: rect.height,
    rect,
  };
}

module.exports = {
  BOX_SCALE,
  normalizeBox2d,
  computeCropRect,
  extractRegionCrop,
};
