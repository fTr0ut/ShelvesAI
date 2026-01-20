function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeStringArray(...values) {
  const out = [];
  values.forEach((value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => out.push(entry));
    } else {
      out.push(value);
    }
  });
  const normalized = out.map((entry) => normalizeString(entry)).filter(Boolean);
  return Array.from(new Set(normalized));
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
    'Director',
    'Maker',
    'Brand',
    'producer',
  ]);
  const manufacturer = pickFirstValue(normalized, [
    'manufacturer',
    'Manufacturer',
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
  const limitedEdition = pickFirstValue(normalized, [
    'limitedEdition',
    'Limited Edition',
    'limited_edition',
    'numberedEdition',
  ]);
  const itemSpecificText = pickFirstValue(normalized, [
    'itemSpecificText',
    'Item Specific Text',
    'item_specific_text',
    'uniqueText',
    'rawText',
    'labelText',
    'specialText',
  ]);

  return {
    ...normalized,
    title,
    primaryCreator,
    manufacturer,
    year,
    description,
    ageStatement,
    specialMarkings,
    labelColor,
    regionalItem,
    edition,
    edition,
    barcode,
    limitedEdition,
    itemSpecificText,
    type: normalized.type || shelfType,
    kind: normalized.kind || shelfType,
  };
}

function buildOtherManualPayload(item, shelfType, manualFingerprint) {
  return {
    name: item?.title || null,
    author: item?.primaryCreator || null,
    manufacturer: item?.manufacturer || null,
    type: shelfType || item?.type || null,
    description: item?.description || null,
    year: item?.year || null,
    genre: normalizeStringArray(item?.genre, item?.genres),
    ageStatement: item?.ageStatement || null,
    specialMarkings: item?.specialMarkings || null,
    labelColor: item?.labelColor || null,
    regionalItem: item?.regionalItem || null,
    edition: item?.edition || null,
    barcode: item?.barcode || null,
    limitedEdition: item?.limitedEdition || null,
    itemSpecificText: item?.itemSpecificText || null,
    manualFingerprint: manualFingerprint || null,
  };
}

function hasRequiredOtherFields(item) {
  return !!(item?.title);
}

module.exports = {
  normalizeOtherManualItem,
  buildOtherManualPayload,
  hasRequiredOtherFields,
};
