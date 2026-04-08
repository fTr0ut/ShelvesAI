function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

const OTHER_MANUAL_FUZZY_AUTO_COMBINED_THRESHOLD = 0.92;
const OTHER_MANUAL_FUZZY_AUTO_TITLE_THRESHOLD = 0.90;
const OTHER_MANUAL_FUZZY_REVIEW_MIN_THRESHOLD = 0.82;

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeConfidence(value) {
  const num = toFiniteNumber(value, 0);
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function normalizeBarcode(value) {
  const raw = normalizeString(value);
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return compact || null;
}

function canonicalizeOtherManualText(value) {
  const raw = normalizeString(value);
  if (!raw) return null;
  const normalized = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return normalized || null;
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

function normalizeSourceLinks(value) {
  if (value == null) return [];
  const source = Array.isArray(value) ? value : [value];
  return source
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        const url = normalizeString(entry);
        return url ? { url } : null;
      }
      if (typeof entry === 'object') {
        const url = normalizeString(entry.url || entry.link || entry.href);
        if (!url) return null;
        const label = normalizeString(entry.label || entry.name || entry.title);
        return label ? { url, label } : { url };
      }
      return null;
    })
    .filter(Boolean);
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
  const marketValue = pickFirstValue(normalized, [
    'marketValue',
    'market_value',
    'Market Value',
    'estimatedMarketValue',
    'estimated_value',
  ]);
  const marketValueSources = normalizeSourceLinks(
    normalized.marketValueSources ||
    normalized.market_value_sources ||
    normalized.marketSources ||
    normalized.marketValueLinks,
  );
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
    marketValue,
    marketValueSources,
    ageStatement,
    specialMarkings,
    labelColor,
    regionalItem,
    edition,
    barcode,
    normalizedBarcode: normalizeBarcode(barcode),
    canonicalTitle: canonicalizeOtherManualText(title),
    canonicalCreator: canonicalizeOtherManualText(primaryCreator),
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
    publisher: item?.publisher || null,
    manufacturer: item?.manufacturer || null,
    format: item?.format || item?.physical?.format || null,
    type: shelfType || item?.type || null,
    description: item?.description || null,
    marketValue: item?.marketValue || item?.market_value || null,
    marketValueSources: normalizeSourceLinks(
      item?.marketValueSources || item?.market_value_sources || item?.marketSources,
    ),
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
    tags: normalizeStringArray(item?.tags, item?.genre, item?.genres),
  };
}

function hasRequiredOtherFields(item, options = {}) {
  const requireCreator = options.requireCreator !== false;
  const hasTitle = !!normalizeString(item?.title);
  if (!hasTitle) return false;
  if (!requireCreator) return true;
  return !!normalizeString(item?.primaryCreator);
}

function getOtherManualDedupKey(item = {}) {
  const barcode = normalizeBarcode(item.normalizedBarcode || item.barcode);
  if (barcode) return `barcode:${barcode}`;

  const manualFingerprint = normalizeString(item.manualFingerprint);
  if (manualFingerprint) return `fingerprint:${manualFingerprint}`;

  const canonicalTitle = canonicalizeOtherManualText(item.canonicalTitle || item.title || item.name);
  const canonicalCreator = canonicalizeOtherManualText(item.canonicalCreator || item.primaryCreator || item.author || item.creator);
  if (canonicalTitle && canonicalCreator) {
    return `canonical:${canonicalTitle}|${canonicalCreator}`;
  }
  return null;
}

function getItemRichnessScore(item) {
  if (!item || typeof item !== 'object') return 0;
  let score = 0;
  for (const value of Object.values(item)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim()) score += 1;
    if (Array.isArray(value) && value.length > 0) score += 1;
  }
  return score;
}

function chooseBetterItem(existing, incoming) {
  const existingConfidence = normalizeConfidence(existing?.confidence);
  const incomingConfidence = normalizeConfidence(incoming?.confidence);
  if (incomingConfidence > existingConfidence) return incoming;
  if (incomingConfidence < existingConfidence) return existing;
  return getItemRichnessScore(incoming) > getItemRichnessScore(existing) ? incoming : existing;
}

function dedupeOtherManualCandidates(items = []) {
  const deduped = [];
  const keyIndex = new Map();
  let droppedCount = 0;

  for (const item of items) {
    const normalized = normalizeOtherManualItem(item, item?.type || item?.kind || 'other');
    const key = getOtherManualDedupKey(normalized);
    if (!key) {
      deduped.push(normalized);
      continue;
    }

    if (!keyIndex.has(key)) {
      keyIndex.set(key, deduped.length);
      deduped.push(normalized);
      continue;
    }

    droppedCount += 1;
    const existingIdx = keyIndex.get(key);
    deduped[existingIdx] = chooseBetterItem(deduped[existingIdx], normalized);
  }

  return { deduped, droppedCount };
}

function evaluateOtherManualFuzzyCandidate(candidate) {
  if (!candidate) {
    return { decision: 'none', combinedSim: 0, titleSim: 0, creatorSim: 0 };
  }

  const combinedSim = toFiniteNumber(candidate.combinedSim, 0);
  const titleSim = toFiniteNumber(candidate.titleSim, 0);
  const creatorSim = toFiniteNumber(candidate.creatorSim, 0);

  if (
    combinedSim >= OTHER_MANUAL_FUZZY_AUTO_COMBINED_THRESHOLD
    && titleSim >= OTHER_MANUAL_FUZZY_AUTO_TITLE_THRESHOLD
  ) {
    return { decision: 'fuzzy_auto', combinedSim, titleSim, creatorSim };
  }

  if (combinedSim >= OTHER_MANUAL_FUZZY_REVIEW_MIN_THRESHOLD) {
    return { decision: 'fuzzy_review', combinedSim, titleSim, creatorSim };
  }

  return { decision: 'none', combinedSim, titleSim, creatorSim };
}

module.exports = {
  normalizeOtherManualItem,
  buildOtherManualPayload,
  hasRequiredOtherFields,
  canonicalizeOtherManualText,
  normalizeBarcode,
  getOtherManualDedupKey,
  dedupeOtherManualCandidates,
  evaluateOtherManualFuzzyCandidate,
  OTHER_MANUAL_FUZZY_AUTO_COMBINED_THRESHOLD,
  OTHER_MANUAL_FUZZY_AUTO_TITLE_THRESHOLD,
  OTHER_MANUAL_FUZZY_REVIEW_MIN_THRESHOLD,
};
