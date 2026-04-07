const sharp = require('sharp');
const logger = require('../logger');
const {
    BOX_COORDINATE_MODES,
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

    it('uses refined persisted normalized boxes directly without introducing extra offset', () => {
        const rect = computeCropRect([111, 222, 333, 444], 1000, 1000);

        expect(rect).toEqual({
            left: 222,
            top: 111,
            width: 222,
            height: 222,
        });
    });

    it('uses normalized mode for persisted overflow boxes instead of repairing them as absolute pixels', () => {
        const rect = computeCropRect(
            [629, 993, 856, 1028],
            4284,
            5712,
            { coordinateMode: BOX_COORDINATE_MODES.NORMALIZED },
        );

        expect(rect).toEqual({
            left: 4254,
            top: 3592,
            width: 30,
            height: 1298,
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

    it('warns and uses decoded image metadata when stored scan dimensions do not match the source image', async () => {
        const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
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
            imageWidth: 120,
            imageHeight: 60,
            coordinateMode: BOX_COORDINATE_MODES.NORMALIZED,
        });

        expect(crop.width).toBe(50);
        expect(crop.height).toBe(25);
        expect(warnSpy).toHaveBeenCalledWith(
            '[visionCropper] Scan photo dimensions differ from decoded image metadata; using decoded metadata for crop math',
            expect.objectContaining({
                providedWidth: 120,
                providedHeight: 60,
                metadataWidth: 100,
                metadataHeight: 50,
                coordinateMode: BOX_COORDINATE_MODES.NORMALIZED,
            }),
        );

        warnSpy.mockRestore();
    });
});
