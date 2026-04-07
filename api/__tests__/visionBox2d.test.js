const {
    BOX_COORDINATE_MODES,
    normalizeVisionBox2d,
} = require('../utils/visionBox2d');

describe('visionBox2d', () => {
    it('clamps slight provider overflow as normalized noise instead of repairing as absolute pixels', () => {
        const normalized = normalizeVisionBox2d(
            [629, 993, 856, 1028],
            {
                imageWidth: 4284,
                imageHeight: 5712,
                mode: BOX_COORDINATE_MODES.PROVIDER_AUTO,
            },
        );

        expect(normalized).toEqual([629, 993, 856, 1000]);
    });

    it('repairs obvious absolute pixel boxes when explicit absolute mode is requested', () => {
        const normalized = normalizeVisionBox2d(
            [200, 400, 1200, 800],
            {
                imageWidth: 2000,
                imageHeight: 2000,
                mode: BOX_COORDINATE_MODES.ABSOLUTE,
            },
        );

        expect(normalized).toEqual([100, 200, 600, 400]);
    });

    it('does not reinterpret persisted normalized boxes as absolute in normalized mode', () => {
        const normalized = normalizeVisionBox2d(
            [629, 993, 856, 1028],
            {
                imageWidth: 4284,
                imageHeight: 5712,
                mode: BOX_COORDINATE_MODES.NORMALIZED,
            },
        );

        expect(normalized).toEqual([629, 993, 856, 1000]);
    });
});
