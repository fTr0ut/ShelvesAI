const BOX_SCALE = 1000;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeVisionDimension(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric);
}

function toNumericBox2d(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numeric = value.map((entry) => Number(entry));
  if (!numeric.every((entry) => Number.isFinite(entry))) return null;
  return numeric;
}

function normalizeNormalizedBox2d(value) {
  const numeric = toNumericBox2d(value);
  if (!numeric) return null;
  const clamped = numeric.map((entry) => clamp(Math.round(entry), 0, BOX_SCALE));
  const [yMin, xMin, yMax, xMax] = clamped;
  if (yMax <= yMin || xMax <= xMin) return null;
  return clamped;
}

function toNormalizedFromAbsolute(value, imageWidth, imageHeight) {
  const numeric = toNumericBox2d(value);
  const width = normalizeVisionDimension(imageWidth);
  const height = normalizeVisionDimension(imageHeight);
  if (!numeric || !width || !height) return null;

  const [yMinRaw, xMinRaw, yMaxRaw, xMaxRaw] = numeric;
  const normalized = [
    (yMinRaw / height) * BOX_SCALE,
    (xMinRaw / width) * BOX_SCALE,
    (yMaxRaw / height) * BOX_SCALE,
    (xMaxRaw / width) * BOX_SCALE,
  ];
  return normalizeNormalizedBox2d(normalized);
}

function isOutOfRangeBox2d(value) {
  const numeric = toNumericBox2d(value);
  if (!numeric) return false;
  return numeric.some((entry) => entry < 0 || entry > BOX_SCALE);
}

function normalizeVisionBox2d(value, options = {}) {
  const { imageWidth = null, imageHeight = null } = options;
  if (!Array.isArray(value) || value.length !== 4) return null;

  if (isOutOfRangeBox2d(value)) {
    const repaired = toNormalizedFromAbsolute(value, imageWidth, imageHeight);
    if (repaired) return repaired;
  }

  return normalizeNormalizedBox2d(value);
}

function normalizePixelPadding(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Math.round(fallback));
  return Math.round(parsed);
}

function expandVisionBox2dByPixels(
  value,
  {
    imageWidth = null,
    imageHeight = null,
    paddingXPx = 0,
    paddingYPx = 0,
  } = {},
) {
  const normalized = normalizeNormalizedBox2d(value);
  if (!normalized) return null;

  const width = normalizeVisionDimension(imageWidth);
  const height = normalizeVisionDimension(imageHeight);
  if (!width || !height) return normalized;

  const padX = normalizePixelPadding(paddingXPx, 0);
  const padY = normalizePixelPadding(paddingYPx, 0);
  if (padX === 0 && padY === 0) return normalized;

  const [yMin, xMin, yMax, xMax] = normalized;
  const left = clamp((xMin / BOX_SCALE) * width - padX, 0, width);
  const right = clamp((xMax / BOX_SCALE) * width + padX, 0, width);
  const top = clamp((yMin / BOX_SCALE) * height - padY, 0, height);
  const bottom = clamp((yMax / BOX_SCALE) * height + padY, 0, height);

  if (right <= left || bottom <= top) return normalized;

  return normalizeNormalizedBox2d([
    (top / height) * BOX_SCALE,
    (left / width) * BOX_SCALE,
    (bottom / height) * BOX_SCALE,
    (right / width) * BOX_SCALE,
  ]);
}

module.exports = {
  BOX_SCALE,
  normalizeVisionDimension,
  normalizeVisionBox2d,
  normalizeNormalizedBox2d,
  toNumericBox2d,
  isOutOfRangeBox2d,
  normalizePixelPadding,
  expandVisionBox2dByPixels,
};
