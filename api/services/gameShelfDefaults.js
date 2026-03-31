const PLATFORM_TYPES = new Set([
    'all',
    'playstation',
    'xbox',
    'nintendo',
    'pc',
    'steam_deck',
    'custom',
]);

const PLATFORM_DEFAULT_LABELS = Object.freeze({
    playstation: 'PlayStation',
    xbox: 'Xbox',
    nintendo: 'Nintendo',
    pc: 'PC',
    steam_deck: 'Steam Deck',
});

const GAME_FORMATS = new Set(['physical', 'digital']);

const PLATFORM_FAMILY_KEYWORDS = Object.freeze({
    playstation: ['playstation', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'psp', 'vita'],
    xbox: ['xbox', 'xbox360', 'xboxone', 'seriesx', 'seriess', 'xsx', 'xss'],
    nintendo: ['nintendo', 'switch', 'wii', 'wiiu', 'gameboy', 'gba', 'nds', '3ds', 'n64', 'nes', 'snes', 'gamecube'],
    pc: ['pc', 'windows', 'microsoftwindows', 'mac', 'linux', 'steam', 'epicgames', 'gog'],
    steam_deck: ['steamdeck'],
});

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

function normalizeToken(value) {
    return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isGamesShelfType(value) {
    const normalized = normalizeString(value).toLowerCase();
    return normalized === 'games' || normalized === 'game';
}

function normalizeGameFormat(value) {
    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) return null;
    return GAME_FORMATS.has(normalized) ? normalized : null;
}

function normalizeGameDefaultsInput(rawValue, { shelfType = null } = {}) {
    if (!isGamesShelfType(shelfType)) return null;
    if (rawValue == null) return null;
    if (typeof rawValue !== 'object' || Array.isArray(rawValue)) {
        throw new Error('gameDefaults must be an object');
    }

    const rawPlatformType = normalizeString(rawValue.platformType).toLowerCase();
    const hasPlatformType = rawPlatformType.length > 0;
    if (hasPlatformType && !PLATFORM_TYPES.has(rawPlatformType)) {
        throw new Error('gameDefaults.platformType must be one of: all, playstation, xbox, nintendo, pc, steam_deck, custom');
    }

    const rawCustomPlatformText = normalizeString(rawValue.customPlatformText);
    if (rawCustomPlatformText && rawPlatformType !== 'custom') {
        throw new Error('gameDefaults.customPlatformText is only allowed when platformType is "custom"');
    }
    if (rawPlatformType === 'custom' && !rawCustomPlatformText) {
        throw new Error('gameDefaults.customPlatformText is required when platformType is "custom"');
    }

    const normalizedFormat = normalizeGameFormat(rawValue.format);
    if (normalizeString(rawValue.format) && !normalizedFormat) {
        throw new Error('gameDefaults.format must be either "physical" or "digital"');
    }

    const normalized = {
        platformType: hasPlatformType ? rawPlatformType : null,
        customPlatformText: rawPlatformType === 'custom' ? rawCustomPlatformText : null,
        format: normalizedFormat,
    };

    if (!normalized.platformType && !normalized.customPlatformText && !normalized.format) {
        return null;
    }
    return normalized;
}

function normalizeGameDefaultsForResponse(rawValue, { shelfType = null } = {}) {
    if (!isGamesShelfType(shelfType)) return null;
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return null;
    const platformType = normalizeString(rawValue.platformType).toLowerCase();
    const customPlatformText = normalizeString(rawValue.customPlatformText);
    const format = normalizeGameFormat(rawValue.format);
    if (!platformType && !customPlatformText && !format) return null;
    return {
        platformType: platformType || null,
        customPlatformText: platformType === 'custom' ? customPlatformText || null : null,
        format: format || null,
    };
}

function areGameDefaultsEqual(a, b) {
    const left = normalizeGameDefaultsForResponse(a, { shelfType: 'games' });
    const right = normalizeGameDefaultsForResponse(b, { shelfType: 'games' });
    return JSON.stringify(left) === JSON.stringify(right);
}

function collectPlatformEvidence(collectable = null) {
    const values = [];
    if (!collectable || typeof collectable !== 'object') return values;

    const systemName = normalizeString(collectable.systemName || collectable.system_name);
    if (systemName) values.push(systemName);

    const platformDataRaw = Array.isArray(collectable.platformData)
        ? collectable.platformData
        : Array.isArray(collectable.platform_data)
            ? collectable.platform_data
            : [];
    platformDataRaw.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const name = normalizeString(entry.name);
        const abbreviation = normalizeString(entry.abbreviation || entry.abbr);
        if (name) values.push(name);
        if (abbreviation) values.push(abbreviation);
    });

    const seen = new Set();
    const deduped = [];
    values.forEach((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(value);
    });
    return deduped;
}

function resolvePlatformLabel(gameDefaults) {
    const normalized = normalizeGameDefaultsForResponse(gameDefaults, { shelfType: 'games' });
    if (!normalized) return null;
    if (normalized.platformType === 'custom') {
        return normalized.customPlatformText || null;
    }
    return PLATFORM_DEFAULT_LABELS[normalized.platformType] || null;
}

function evidenceMatchesPresetPlatform(evidenceTokens, platformType) {
    const keywords = PLATFORM_FAMILY_KEYWORDS[platformType] || [];
    if (!keywords.length) return false;
    return evidenceTokens.some((token) => {
        return keywords.some((keyword) => token.includes(keyword) || keyword.includes(token));
    });
}

function evidenceMatchesCustomPlatform(evidenceTokens, customPlatformText) {
    const customToken = normalizeToken(customPlatformText);
    if (!customToken) return false;
    return evidenceTokens.some((token) => token.includes(customToken) || customToken.includes(token));
}

function hasPlatformMismatch({ platformType, customPlatformText, evidence }) {
    if (!platformType || platformType === 'all') return false;
    if (!Array.isArray(evidence) || evidence.length === 0) return false;
    const evidenceTokens = evidence.map((entry) => normalizeToken(entry)).filter(Boolean);
    if (!evidenceTokens.length) return false;

    if (platformType === 'custom') {
        return !evidenceMatchesCustomPlatform(evidenceTokens, customPlatformText);
    }
    return !evidenceMatchesPresetPlatform(evidenceTokens, platformType);
}

function resolveGameShelfDefaultsForItem({
    shelfType,
    gameDefaults = null,
    collectable = null,
} = {}) {
    if (!isGamesShelfType(shelfType)) {
        return { format: null, ownedPlatforms: [], platformMissing: false };
    }

    const normalizedDefaults = normalizeGameDefaultsForResponse(gameDefaults, { shelfType });
    if (!normalizedDefaults) {
        return { format: null, ownedPlatforms: [], platformMissing: false };
    }

    const evidence = collectPlatformEvidence(collectable);
    const mismatch = hasPlatformMismatch({
        platformType: normalizedDefaults.platformType,
        customPlatformText: normalizedDefaults.customPlatformText,
        evidence,
    });
    if (mismatch) {
        return { format: null, ownedPlatforms: [], platformMissing: true };
    }

    const platformLabel = resolvePlatformLabel(normalizedDefaults);
    return {
        format: normalizedDefaults.format || null,
        ownedPlatforms: platformLabel ? [platformLabel] : [],
        platformMissing: false,
    };
}

module.exports = {
    PLATFORM_TYPES,
    isGamesShelfType,
    normalizeGameFormat,
    normalizeGameDefaultsInput,
    normalizeGameDefaultsForResponse,
    areGameDefaultsEqual,
    resolveGameShelfDefaultsForItem,
};
