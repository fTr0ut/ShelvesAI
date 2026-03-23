const sharp = require('sharp');
const {
  normalizeThumbnailBox,
  computeThumbnailRect,
  renderOwnerPhotoThumbnail,
  THUMB_TARGET_WIDTH,
  THUMB_TARGET_HEIGHT,
} = require('../services/ownerPhotoThumbnail');

describe('ownerPhotoThumbnail service', () => {
  describe('normalizeThumbnailBox', () => {
    it('clamps out-of-range values into valid normalized bounds', () => {
      const normalized = normalizeThumbnailBox({
        x: -0.2,
        y: 0.9,
        width: 0.8,
        height: 0.5,
      });

      expect(normalized).toEqual({
        x: 0,
        y: 0.9,
        width: 0.8,
        height: 0.1,
      });
    });

    it('throws for malformed values', () => {
      expect(() => normalizeThumbnailBox({ x: 'abc', y: 0, width: 1, height: 1 }))
        .toThrow('Thumbnail box requires numeric x, y, width, and height');
    });

    it('throws for degenerate dimensions', () => {
      expect(() => normalizeThumbnailBox({ x: 0, y: 0, width: 0, height: 1 }))
        .toThrow('Thumbnail box width and height must be greater than zero');
    });
  });

  describe('computeThumbnailRect', () => {
    it('enforces 3:4 aspect ratio from arbitrary viewport', () => {
      const result = computeThumbnailRect({
        imageWidth: 1200,
        imageHeight: 900,
        box: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
      });
      const ratio = result.rect.width / result.rect.height;
      expect(ratio).toBeCloseTo(3 / 4, 2);
    });
  });

  describe('renderOwnerPhotoThumbnail', () => {
    it('renders a fixed-size JPEG thumbnail', async () => {
      const sourceBuffer = await sharp({
        create: {
          width: 600,
          height: 800,
          channels: 3,
          background: { r: 220, g: 80, b: 40 },
        },
      })
        .jpeg({ quality: 90 })
        .toBuffer();

      const rendered = await renderOwnerPhotoThumbnail({
        sourceBuffer,
        box: { x: 0.05, y: 0.1, width: 0.8, height: 0.8 },
      });

      expect(rendered.contentType).toBe('image/jpeg');
      expect(rendered.width).toBe(THUMB_TARGET_WIDTH);
      expect(rendered.height).toBe(THUMB_TARGET_HEIGHT);

      const metadata = await sharp(rendered.buffer).metadata();
      expect(metadata.width).toBe(THUMB_TARGET_WIDTH);
      expect(metadata.height).toBe(THUMB_TARGET_HEIGHT);
    });
  });
});
