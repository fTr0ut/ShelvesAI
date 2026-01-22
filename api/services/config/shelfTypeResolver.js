/**
 * ShelfTypeResolver
 * 
 * Utility module for resolving shelf types from various inputs (singular, plural, aliases)
 * to their canonical form. Loads configuration from shelfType.json.
 */

const fs = require('fs');
const path = require('path');

// Load shelf type config
let shelfTypeConfig = null;
let typeAliasMap = null; // Map from alias -> canonical type

function loadConfig() {
    if (shelfTypeConfig) return shelfTypeConfig;

    try {
        const configPath = path.join(__dirname, '../../config/shelfType.json');
        if (fs.existsSync(configPath)) {
            shelfTypeConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            buildAliasMap();
            console.log('[ShelfTypeResolver] Loaded shelf type config');
        } else {
            console.warn('[ShelfTypeResolver] shelfType.json not found, using defaults');
            shelfTypeConfig = { types: {}, defaultType: 'other' };
        }
    } catch (err) {
        console.error('[ShelfTypeResolver] Failed to load shelfType.json:', err.message);
        shelfTypeConfig = { types: {}, defaultType: 'other' };
    }

    return shelfTypeConfig;
}

function buildAliasMap() {
    typeAliasMap = new Map();
    const config = loadConfig();

    for (const [canonical, typeConfig] of Object.entries(config.types || {})) {
        // Map canonical to itself
        typeAliasMap.set(canonical.toLowerCase(), canonical);

        // Map all aliases to canonical
        for (const alias of (typeConfig.aliases || [])) {
            typeAliasMap.set(alias.toLowerCase(), canonical);
        }
    }
}

/**
 * Normalize a string for comparison
 * @param {string} value 
 * @returns {string}
 */
function normalizeString(value) {
    if (!value) return '';
    return String(value).trim().toLowerCase();
}

/**
 * Resolve any shelf type input to its canonical form
 * @param {string} input - Type input (singular, plural, or alias)
 * @returns {string} Canonical type (e.g., 'books', 'movies') or defaultType if not found
 */
function resolveShelfType(input) {
    const config = loadConfig();
    if (!typeAliasMap) buildAliasMap();

    const normalized = normalizeString(input);
    if (!normalized) return config.defaultType || 'other';

    // Direct match in alias map
    if (typeAliasMap.has(normalized)) {
        return typeAliasMap.get(normalized);
    }

    // Check if input contains any alias (fuzzy matching for compound names like "video games")
    for (const [alias, canonical] of typeAliasMap.entries()) {
        if (normalized.includes(alias) || alias.includes(normalized)) {
            return canonical;
        }
    }

    return config.defaultType || 'other';
}

/**
 * Get config for a specific canonical shelf type
 * @param {string} canonicalType 
 * @returns {Object|null}
 */
function getShelfTypeConfig(canonicalType) {
    const config = loadConfig();
    return config.types?.[canonicalType] || null;
}

/**
 * Check if an input type matches a target canonical type (including aliases)
 * @param {string} input - Type input to check
 * @param {string} targetType - Canonical type to match against (e.g., 'books')
 * @returns {boolean}
 */
function supportsShelfType(input, targetType) {
    const resolved = resolveShelfType(input);
    return resolved === targetType;
}

/**
 * Get all aliases for a canonical type (including the canonical itself)
 * @param {string} canonicalType 
 * @returns {string[]}
 */
function getAllAliases(canonicalType) {
    const config = loadConfig();
    const typeConfig = config.types?.[canonicalType];
    if (!typeConfig) return [canonicalType];

    return [canonicalType, ...(typeConfig.aliases || [])];
}

/**
 * Get the API container key for a shelf type
 * @param {string} input - Type input
 * @returns {string|null}
 */
function getApiContainerKey(input) {
    const canonical = resolveShelfType(input);
    const typeConfig = getShelfTypeConfig(canonical);
    return typeConfig?.apiContainerKey || null;
}

/**
 * Get all canonical shelf types
 * @returns {string[]}
 */
function getAllCanonicalTypes() {
    const config = loadConfig();
    return Object.keys(config.types || {});
}

module.exports = {
    resolveShelfType,
    getShelfTypeConfig,
    supportsShelfType,
    getAllAliases,
    getApiContainerKey,
    getAllCanonicalTypes,
    loadConfig,
};
