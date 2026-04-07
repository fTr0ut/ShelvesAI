const sharp = require('sharp');
const {
  MAX_IMAGE_DIMENSION,
  validateImageBuffer,
} = require('../utils/imageValidation');

const RESIZED_JPEG_QUALITY = 85;
const RESIZED_WEBP_QUALITY = 85;

function buildFormatPipeline(pipeline, mime) {
  if (mime === 'image/png') {
    return pipeline.png();
  }
  if (mime === 'image/webp') {
    return pipeline.webp({ quality: RESIZED_WEBP_QUALITY });
  }
  return pipeline.jpeg({ quality: RESIZED_JPEG_QUALITY, mozjpeg: true });
}

async function prepareShelfUploadImage(buffer, options = {}) {
  const maxDimension = Number.isFinite(options.maxDimension) && options.maxDimension > 0
    ? options.maxDimension
    : MAX_IMAGE_DIMENSION;
  const original = await validateImageBuffer(buffer, {
    maxDimension: Number.MAX_SAFE_INTEGER,
  });

  if (original.width <= maxDimension && original.height <= maxDimension) {
    return {
      buffer,
      mime: original.mime,
      width: original.width,
      height: original.height,
      sizeBytes: buffer.length,
    };
  }

  const resizedBuffer = await buildFormatPipeline(
    sharp(buffer, { failOnError: false })
      .rotate()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      }),
    original.mime,
  ).toBuffer();

  const processed = await validateImageBuffer(resizedBuffer, { maxDimension });
  return {
    buffer: resizedBuffer,
    mime: processed.mime,
    width: processed.width,
    height: processed.height,
    sizeBytes: resizedBuffer.length,
  };
}

module.exports = {
  prepareShelfUploadImage,
};
