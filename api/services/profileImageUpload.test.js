const sharp = require('sharp');
const { prepareProfileUploadImage, MAX_PROFILE_IMAGE_DIMENSION } = require('./profileImageUpload');

describe('prepareProfileUploadImage', () => {
  it('normalizes oversized profile photos down to the configured max dimension', async () => {
    const buffer = await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 3,
        background: { r: 40, g: 80, b: 120 },
      },
    }).jpeg().toBuffer();

    const prepared = await prepareProfileUploadImage(buffer);

    expect(prepared.mime).toBe('image/jpeg');
    expect(prepared.width).toBe(MAX_PROFILE_IMAGE_DIMENSION);
    expect(prepared.height).toBeLessThanOrEqual(MAX_PROFILE_IMAGE_DIMENSION);
    expect(Buffer.isBuffer(prepared.buffer)).toBe(true);
  });

  it('re-encodes supported images even when already within bounds', async () => {
    const buffer = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 4,
        background: { r: 220, g: 30, b: 90, alpha: 1 },
      },
    }).png().toBuffer();

    const prepared = await prepareProfileUploadImage(buffer);

    expect(prepared.mime).toBe('image/png');
    expect(prepared.width).toBe(400);
    expect(prepared.height).toBe(400);
    expect(prepared.sizeBytes).toBe(prepared.buffer.length);
    expect(prepared.sizeBytes).toBeGreaterThan(0);
  });
});
