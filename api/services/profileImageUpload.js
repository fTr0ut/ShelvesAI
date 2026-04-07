const sharp = require('sharp');
const { validateImageBuffer } = require('../utils/imageValidation');

const MAX_PROFILE_IMAGE_DIMENSION = 1024;
const JPEG_QUALITY = 85;
const WEBP_QUALITY = 85;

function buildFormatPipeline(pipeline, mime) {
  if (mime === 'image/png') {
    return pipeline.png();
  }
  if (mime === 'image/webp') {
    return pipeline.webp({ quality: WEBP_QUALITY });
  }
  return pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
}

async function prepareProfileUploadImage(buffer, options = {}) {
  const maxDimension = Number.isFinite(options.maxDimension) && options.maxDimension > 0
    ? options.maxDimension
    : MAX_PROFILE_IMAGE_DIMENSION;
  const original = await validateImageBuffer(buffer, {
    maxDimension: Number.MAX_SAFE_INTEGER,
  });

  const processedBuffer = await buildFormatPipeline(
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

  const processed = await validateImageBuffer(processedBuffer, { maxDimension });
  return {
    buffer: processedBuffer,
    mime: processed.mime,
    width: processed.width,
    height: processed.height,
    sizeBytes: processedBuffer.length,
  };
}

module.exports = {
  MAX_PROFILE_IMAGE_DIMENSION,
  prepareProfileUploadImage,
};
