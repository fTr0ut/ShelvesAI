const sharp = require('sharp');
const {
  BOX_SCALE,
  BOX_COORDINATE_MODES,
  normalizeVisionDimension,
  normalizeVisionBox2d,
} = require('../utils/visionBox2d');
const logger = require('../logger');

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeBox2d(box2d, options = {}) {
  return normalizeVisionBox2d(box2d, options);
}

function computeCropRect(box2d, imageWidth, imageHeight, options = {}) {
  const width = normalizeVisionDimension(imageWidth);
  const height = normalizeVisionDimension(imageHeight);
  const coordinateMode = options.coordinateMode || options.mode || BOX_COORDINATE_MODES.PROVIDER_AUTO;
  const normalized = normalizeBox2d(box2d, {
    imageWidth: width,
    imageHeight: height,
    mode: coordinateMode,
  });
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
  coordinateMode = BOX_COORDINATE_MODES.PROVIDER_AUTO,
}) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error('Scan photo image buffer is empty');
  }

  const source = sharp(imageBuffer, { failOnError: false });
  const metadata = await source.metadata();
  const providedWidth = normalizeVisionDimension(imageWidth);
  const providedHeight = normalizeVisionDimension(imageHeight);
  const metadataWidth = normalizeVisionDimension(metadata?.width);
  const metadataHeight = normalizeVisionDimension(metadata?.height);

  let width = providedWidth || metadataWidth;
  let height = providedHeight || metadataHeight;

  const dimensionsMismatch = (
    providedWidth
    && providedHeight
    && metadataWidth
    && metadataHeight
    && (providedWidth !== metadataWidth || providedHeight !== metadataHeight)
  );

  if (dimensionsMismatch) {
    logger.warn('[visionCropper] Scan photo dimensions differ from decoded image metadata; using decoded metadata for crop math', {
      providedWidth,
      providedHeight,
      metadataWidth,
      metadataHeight,
      coordinateMode,
    });
    width = metadataWidth;
    height = metadataHeight;
  }

  if (!width || !height) {
    throw new Error('Unable to determine scan photo dimensions for crop extraction');
  }

  const rect = computeCropRect(box2d, width, height, { coordinateMode });
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
  BOX_COORDINATE_MODES,
  normalizeBox2d,
  computeCropRect,
  extractRegionCrop,
};
