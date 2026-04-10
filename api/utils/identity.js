'use strict';

function normalizeComparableId(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
}

function isSameComparableId(a, b) {
    const normalizedA = normalizeComparableId(a);
    const normalizedB = normalizeComparableId(b);
    if (!normalizedA || !normalizedB) return false;
    return normalizedA === normalizedB;
}

module.exports = {
    normalizeComparableId,
    isSameComparableId,
};
