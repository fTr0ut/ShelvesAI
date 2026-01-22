const { VisionPipelineHooks, HOOK_TYPES } = require('../services/visionPipelineHooks');

describe('VisionPipelineHooks', () => {
    it('registers and executes hooks in priority order', async () => {
        const logger = { warn: jest.fn() };
        const hooks = new VisionPipelineHooks({ enabled: true, logger });
        const calls = [];

        hooks.register(HOOK_TYPES.AFTER_VISION_OCR, () => calls.push('low'), { priority: 1 });
        hooks.register(HOOK_TYPES.AFTER_VISION_OCR, () => calls.push('high'), { priority: 5 });

        await hooks.execute(HOOK_TYPES.AFTER_VISION_OCR, { items: [] });

        expect(calls).toEqual(['high', 'low']);
    });

    it('isolates hook errors and continues', async () => {
        const logger = { warn: jest.fn() };
        const hooks = new VisionPipelineHooks({ enabled: true, logger });
        const calls = [];

        hooks.register(HOOK_TYPES.AFTER_VISION_OCR, () => {
            throw new Error('boom');
        });
        hooks.register(HOOK_TYPES.AFTER_VISION_OCR, () => calls.push('ok'));

        const result = await hooks.execute(HOOK_TYPES.AFTER_VISION_OCR, {});

        expect(calls).toEqual(['ok']);
        expect(result.errors.length).toBe(1);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('unregisters hooks', async () => {
        const hooks = new VisionPipelineHooks({ enabled: true });
        const calls = [];

        const handler = () => calls.push('hit');
        hooks.register(HOOK_TYPES.AFTER_VISION_OCR, handler);
        hooks.unregister(HOOK_TYPES.AFTER_VISION_OCR, handler);

        await hooks.execute(HOOK_TYPES.AFTER_VISION_OCR, {});

        expect(calls).toEqual([]);
    });
});
