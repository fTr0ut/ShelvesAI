const sharp = require('sharp');

const THUMB_ASPECT_WIDTH = 3;
const THUMB_ASPECT_HEIGHT = 4;
const THUMB_TARGET_WIDTH = 300;
const THUMB_TARGET_HEIGHT = 400;
const THUMB_JPEG_QUALITY = 85;
const BOX_DECIMALS = 6;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundBox(value) {
  return Number(value.toFixed(BOX_DECIMALS));
}

function normalizeThumbnailBox(box, { allowNull = true } = {}) {
  if (box == null) {
    if (allowNull) return null;
    throw new Error('Thumbnail box is required');
  }
  if (typeof box !== 'object' || Array.isArray(box)) {
    throw new Error('Thumbnail box must be an object');
  }

  const xRaw = Number(box.x);
  const yRaw = Number(box.y);
  const widthRaw = Number(box.width);
  const heightRaw = Number(box.height);
  if (![xRaw, yRaw, widthRaw, heightRaw].every(Number.isFinite)) {
    throw new Error('Thumbnail box requires numeric x, y, width, and height');
  }

  let x = clamp(xRaw, 0, 1);
  let y = clamp(yRaw, 0, 1);
  let width = clamp(widthRaw, 0, 1);
  let height = clamp(heightRaw, 0, 1);

  if (width <= 0 || height <= 0) {
    throw new Error('Thumbnail box width and height must be greater than zero');
  }

  if (x + width > 1) width = 1 - x;
  if (y + height > 1) height = 1 - y;
  if (width <= 0 || height <= 0) {
    throw new Error('Thumbnail box is outside image bounds');
  }

  return {
    x: roundBox(x),
    y: roundBox(y),
    width: roundBox(width),
    height: roundBox(height),
  };
}

function toPixelRect(box, imageWidth, imageHeight) {
  const width = Math.max(1, Math.round(Number(imageWidth) || 0));
  const height = Math.max(1, Math.round(Number(imageHeight) || 0));

  if (!box) {
    return {
      left: 0,
      top: 0,
      width,
      height,
    };
  }

  const left = clamp(Math.floor(box.x * width), 0, width - 1);
  const top = clamp(Math.floor(box.y * height), 0, height - 1);
  const right = clamp(Math.ceil((box.x + box.width) * width), left + 1, width);
  const bottom = clamp(Math.ceil((box.y + box.height) * height), top + 1, height);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function fitRectToAspect(rect, targetAspect) {
  const ratio = rect.width / rect.height;
  if (Math.abs(ratio - targetAspect) < 1e-6) return rect;

  let nextWidth = rect.width;
  let nextHeight = rect.height;
  if (ratio > targetAspect) {
    nextWidth = Math.max(1, Math.floor(rect.height * targetAspect));
  } else {
    nextHeight = Math.max(1, Math.floor(rect.width / targetAspect));
  }

  const offsetX = Math.floor((rect.width - nextWidth) / 2);
  const offsetY = Math.floor((rect.height - nextHeight) / 2);

  return {
    left: rect.left + offsetX,
    top: rect.top + offsetY,
    width: nextWidth,
    height: nextHeight,
  };
}

function toNormalizedBox(rect, imageWidth, imageHeight) {
  return {
    x: roundBox(rect.left / imageWidth),
    y: roundBox(rect.top / imageHeight),
    width: roundBox(rect.width / imageWidth),
    height: roundBox(rect.height / imageHeight),
  };
}

function computeThumbnailRect({ imageWidth, imageHeight, box = null }) {
  const width = Math.max(1, Math.round(Number(imageWidth) || 0));
  const height = Math.max(1, Math.round(Number(imageHeight) || 0));
  if (!width || !height) {
    throw new Error('Invalid image dimensions for thumbnail');
  }

  const normalized = normalizeThumbnailBox(box, { allowNull: true });
  const selectionRect = toPixelRect(normalized, width, height);
  const rect = fitRectToAspect(selectionRect, THUMB_ASPECT_WIDTH / THUMB_ASPECT_HEIGHT);
  return {
    rect,
    normalizedBox: toNormalizedBox(rect, width, height),
    imageWidth: width,
    imageHeight: height,
  };
}

async function renderOwnerPhotoThumbnail({
  sourceBuffer,
  box = null,
  outputWidth = THUMB_TARGET_WIDTH,
  outputHeight = THUMB_TARGET_HEIGHT,
  jpegQuality = THUMB_JPEG_QUALITY,
}) {
  if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length === 0) {
    throw new Error('Owner photo source buffer is empty');
  }

  const orientedBuffer = await sharp(sourceBuffer, { failOnError: false }).rotate().toBuffer();
  const metadata = await sharp(orientedBuffer, { failOnError: false }).metadata();
  const width = Number(metadata?.width);
  const height = Number(metadata?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Unable to determine owner photo dimensions');
  }

  const { rect, normalizedBox } = computeThumbnailRect({
    imageWidth: width,
    imageHeight: height,
    box,
  });

  const buffer = await sharp(orientedBuffer, { failOnError: false })
    .extract(rect)
    .resize(outputWidth, outputHeight, { fit: 'cover' })
    .jpeg({ quality: jpegQuality, mozjpeg: true })
    .toBuffer();

  return {
    buffer,
    contentType: 'image/jpeg',
    width: outputWidth,
    height: outputHeight,
    box: normalizedBox,
    sourceWidth: width,
    sourceHeight: height,
  };
}

module.exports = {
  THUMB_ASPECT_WIDTH,
  THUMB_ASPECT_HEIGHT,
  THUMB_TARGET_WIDTH,
  THUMB_TARGET_HEIGHT,
  normalizeThumbnailBox,
  computeThumbnailRect,
  renderOwnerPhotoThumbnail,
};

