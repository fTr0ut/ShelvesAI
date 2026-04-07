const sharp = require('sharp');
const { prepareShelfUploadImage } = require('./shelfImageUpload');

async function makeImage({ width, height, format = 'jpeg' }) {
  let pipeline = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 80, g: 120, b: 160 },
    },
  });

  if (format === 'png') {
    pipeline = pipeline.png();
  } else if (format === 'webp') {
    pipeline = pipeline.webp({ quality: 90 });
  } else {
    pipeline = pipeline.jpeg({ quality: 90 });
  }

  return pipeline.toBuffer();
}

describe('prepareShelfUploadImage', () => {
  it('passes through images already within bounds', async () => {
    const buffer = await makeImage({ width: 1200, height: 900, format: 'jpeg' });

    const result = await prepareShelfUploadImage(buffer);

    expect(result).toEqual({
      buffer,
      mime: 'image/jpeg',
      width: 1200,
      height: 900,
      sizeBytes: buffer.length,
    });
  });

  it('downscales oversized images to fit within 4096px', async () => {
    const buffer = await makeImage({ width: 5000, height: 3000, format: 'jpeg' });

    const result = await prepareShelfUploadImage(buffer);
    const metadata = await sharp(result.buffer).metadata();

    expect(result.mime).toBe('image/jpeg');
    expect(result.width).toBe(4096);
    expect(result.height).toBe(2458);
    expect(result.sizeBytes).toBe(result.buffer.length);
    expect(result.buffer.equals(buffer)).toBe(false);
    expect(metadata.width).toBe(4096);
    expect(metadata.height).toBe(2458);
  });

  it('preserves allowed non-jpeg types when resizing', async () => {
    const buffer = await makeImage({ width: 3000, height: 5000, format: 'png' });

    const result = await prepareShelfUploadImage(buffer);

    expect(result.mime).toBe('image/png');
    expect(result.width).toBe(2458);
    expect(result.height).toBe(4096);
  });

  it('rejects unsupported image types', async () => {
    await expect(prepareShelfUploadImage(Buffer.from('not-an-image'))).rejects.toThrow(
      'Unsupported image type. Allowed: JPEG, PNG, WEBP',
    );
  });
});
