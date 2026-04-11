const sizeOf = require('image-size');

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = null;

function normalizeMimeType(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function isAllowedImageMimeType(value) {
  return ALLOWED_IMAGE_MIME_TYPES.has(normalizeMimeType(value));
}

async function validateImageBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Image payload is empty');
  }

  const maxDimension = Number.isFinite(options.maxDimension)
    ? options.maxDimension
    : MAX_IMAGE_DIMENSION;
  const maxPixels = Number.isFinite(options.maxPixels)
    ? options.maxPixels
    : MAX_IMAGE_PIXELS;
  const allowedMimeTypes = options.allowedMimeTypes || ALLOWED_IMAGE_MIME_TYPES;

  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !allowedMimeTypes.has(detected.mime)) {
    throw new Error('Unsupported image type. Allowed: JPEG, PNG, WEBP');
  }

  const dimensions = sizeOf(buffer);
  const width = Number(dimensions?.width);
  const height = Number(dimensions?.height);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions');
  }

  if (width > maxDimension || height > maxDimension) {
    throw new Error(`Image dimensions exceed ${maxDimension}x${maxDimension}`);
  }

  if (Number.isFinite(maxPixels) && maxPixels > 0 && (width * height) > maxPixels) {
    throw new Error(`Image area exceeds ${maxPixels} pixels`);
  }

  return {
    ext: detected.ext,
    mime: detected.mime,
    width,
    height,
  };
}

module.exports = {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  normalizeMimeType,
  isAllowedImageMimeType,
  validateImageBuffer,
};
