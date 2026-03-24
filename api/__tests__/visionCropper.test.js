const sharp = require('sharp');
const {
    computeCropRect,
    extractRegionCrop,
} = require('../services/visionCropper');

describe('visionCropper', () => {
    it('computes a clamped crop rect from normalized box_2d coordinates', () => {
        const rect = computeCropRect([100, 200, 700, 900], 1200, 800);

        expect(rect).toEqual({
            left: 240,
            top: 80,
            width: 840,
            height: 480,
        });
    });

    it('repairs out-of-range absolute box_2d coordinates using image dimensions', () => {
        const rect = computeCropRect([200, 400, 1200, 800], 2000, 2000);

        expect(rect).toEqual({
            left: 400,
            top: 200,
            width: 400,
            height: 1000,
        });
    });

    it('does not add implicit padding when using persisted padded box coordinates', () => {
        const rect = computeCropRect([70, 160, 730, 940], 1200, 800);

        expect(rect).toEqual({
            left: 192,
            top: 56,
            width: 936,
            height: 528,
        });
    });

    it('extracts a jpeg crop buffer with expected dimensions', async () => {
        const imageBuffer = await sharp({
            create: {
                width: 100,
                height: 50,
                channels: 3,
                background: { r: 30, g: 60, b: 90 },
            },
        }).jpeg().toBuffer();

        const crop = await extractRegionCrop({
            imageBuffer,
            box2d: [0, 0, 500, 500],
            imageWidth: 100,
            imageHeight: 50,
        });

        expect(crop.contentType).toBe('image/jpeg');
        expect(crop.width).toBe(50);
        expect(crop.height).toBe(25);
        expect(Buffer.isBuffer(crop.buffer)).toBe(true);
        expect(crop.buffer.length).toBeGreaterThan(0);
    });
});
