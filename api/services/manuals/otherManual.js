function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function pickFirstValue(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = normalizeString(source[key]);
      if (value) return value;
    }
  }
  return null;
}

function normalizeOtherManualItem(rawItem, shelfType = 'other') {
  const normalized = rawItem && typeof rawItem === 'object' ? { ...rawItem } : {};
  const title = pickFirstValue(normalized, ['title', 'name', 'itemName', 'item', 'label']);
  const primaryCreator = pickFirstValue(normalized, [
    'primaryCreator',
    'author',
    'creator',
    'brand',
    'publisher',
    'manufacturer',
    'producer',
  ]);
  const year = pickFirstValue(normalized, ['year', 'Year', 'releaseYear', 'vintage']);
  const description = pickFirstValue(normalized, ['description', 'Description']);
  const ageStatement = pickFirstValue(normalized, ['ageStatement', 'Age statement', 'Age Statement', 'age', 'age_statement']);
  const specialMarkings = pickFirstValue(normalized, ['specialMarkings', 'Special Marking', 'Special markings', 'special_markings']);
  const labelColor = pickFirstValue(normalized, [
    'labelColor',
    'Label color',
    'Color or label color',
    'color',
    'label_color',
  ]);
  const regionalItem = pickFirstValue(normalized, ['regionalItem', 'Regional', 'region', 'regionInfo', 'regional_item']);
  const edition = pickFirstValue(normalized, ['edition', 'Edition', 'Edition(s)', 'edition(s)']);
  const barcode = pickFirstValue(normalized, ['barcode', 'Barcode', 'UPC', 'UPC barcode', 'upc']);

  return {
    ...normalized,
    title,
    primaryCreator,
    year,
    description,
    ageStatement,
    specialMarkings,
    labelColor,
    regionalItem,
    edition,
    barcode,
    type: normalized.type || shelfType,
    kind: normalized.kind || shelfType,
  };
}

function buildOtherManualPayload(item, shelfType, manualFingerprint) {
  return {
    name: item?.title || null,
    author: item?.primaryCreator || null,
    type: shelfType || item?.type || null,
    description: item?.description || null,
    year: item?.year || null,
    ageStatement: item?.ageStatement || null,
    specialMarkings: item?.specialMarkings || null,
    labelColor: item?.labelColor || null,
    regionalItem: item?.regionalItem || null,
    edition: item?.edition || null,
    barcode: item?.barcode || null,
    manualFingerprint: manualFingerprint || null,
  };
}

function hasRequiredOtherFields(item) {
  return !!(item?.title && item?.primaryCreator);
}

module.exports = {
  normalizeOtherManualItem,
  buildOtherManualPayload,
  hasRequiredOtherFields,
};
