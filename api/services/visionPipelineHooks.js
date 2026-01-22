const HOOK_TYPES = {
    AFTER_VISION_OCR: 'afterVisionOCR',
    AFTER_CONFIDENCE_CATEGORIZATION: 'afterConfidenceCategorization',
    AFTER_FINGERPRINT_LOOKUP: 'afterFingerprintLookup',
    AFTER_CATALOG_LOOKUP: 'afterCatalogLookup',
    AFTER_GEMINI_ENRICHMENT: 'afterGeminiEnrichment',
    BEFORE_COLLECTABLE_SAVE: 'beforeCollectableSave',
    BEFORE_MANUAL_SAVE: 'beforeManualSave',
    AFTER_SHELF_UPSERT: 'afterShelfUpsert',
    AFTER_NEEDS_REVIEW_QUEUE: 'afterNeedsReviewQueue',
};

class VisionPipelineHooks {
    constructor(options = {}) {
        this.enabled = options.enabled ?? (process.env.VISION_HOOKS_ENABLED !== 'false');
        this.logger = options.logger || console;
        this.hooks = new Map();
        Object.values(HOOK_TYPES).forEach((type) => this.hooks.set(type, []));
    }

    register(hookType, handler, options = {}) {
        if (!this.hooks.has(hookType)) {
            throw new Error(`Unknown hook type: ${hookType}`);
        }
        if (typeof handler !== 'function') {
            throw new Error('Hook handler must be a function');
        }
        const list = this.hooks.get(hookType);
        const entry = {
            handler,
            priority: options.priority ?? 0,
            name: options.name || handler.name || 'anonymous',
        };
        list.push(entry);
        list.sort((a, b) => b.priority - a.priority);

        return () => this.unregister(hookType, handler);
    }

    unregister(hookType, handler) {
        if (!this.hooks.has(hookType)) return false;
        const list = this.hooks.get(hookType);
        const next = list.filter((entry) => entry.handler !== handler);
        this.hooks.set(hookType, next);
        return next.length !== list.length;
    }

    async execute(hookType, context) {
        if (!this.enabled) return { executed: 0, errors: [] };
        const list = this.hooks.get(hookType) || [];
        const errors = [];
        let executed = 0;

        for (const entry of list) {
            try {
                await entry.handler(context);
                executed += 1;
            } catch (err) {
                errors.push({ hookType, name: entry.name, error: err });
                if (this.logger && typeof this.logger.warn === 'function') {
                    this.logger.warn(
                        `[VisionPipelineHooks] Hook "${hookType}" (${entry.name}) failed:`,
                        err?.message || err,
                    );
                }
            }
        }

        return { executed, errors };
    }
}

let instance = null;

function getVisionPipelineHooks(options) {
    if (!instance) {
        instance = new VisionPipelineHooks(options);
    }
    return instance;
}

function createVisionPipelineHooks(options = {}) {
    return new VisionPipelineHooks(options);
}

module.exports = {
    HOOK_TYPES,
    VisionPipelineHooks,
    getVisionPipelineHooks,
    createVisionPipelineHooks,
};
