const crypto = require('crypto');

function normalizeForFingerprint(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().toLowerCase();
}

function normalizeListForFingerprint(value) {
  if (value === undefined || value === null) return '';
  if (!Array.isArray(value)) {
    return normalizeForFingerprint(value);
  }

  const stack = [...value];
  const seen = new Set();
  while (stack.length) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      stack.push(...item);
      continue;
    }
    const normalized = normalizeForFingerprint(item);
    if (normalized) {
      seen.add(normalized);
    }
  }

  if (!seen.size) return '';
  return Array.from(seen).sort().join(',');
}

const MEDIA_TYPE_ALIASES = {
  book: 'book',
  books: 'book',
  movie: 'movie',
  movies: 'movie',
  film: 'movie',
  films: 'movie',
  game: 'game',
  games: 'game',
  videogame: 'game',
  videogames: 'game',
};

function normalizeMediaTypeForFingerprint(value) {
  const normalized = normalizeForFingerprint(value);
  if (!normalized) return '';
  const compact = normalized.replace(/[^a-z0-9]+/g, '');
  return MEDIA_TYPE_ALIASES[normalized] || MEDIA_TYPE_ALIASES[compact] || normalized;
}

function sha1FromString(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex');
}

function makeCollectableFingerprint(input = {}) {
  if (typeof input !== 'object' || input === null) {
    const base = normalizeForFingerprint(input);
    return base ? sha1FromString(base) : null;
  }

  if (input.uniqueKey) {
    const key = normalizeForFingerprint(input.uniqueKey);
    return key ? sha1FromString(key) : null;
  }

  const title = normalizeForFingerprint(input.title);
  const creator = normalizeForFingerprint(
    input.primaryCreator ?? input.creator ?? input.author,
  );
  const year = normalizeForFingerprint(input.releaseYear ?? input.year);

  const parts = [title, creator, year];

  const mediaType = normalizeMediaTypeForFingerprint(input.mediaType ?? input.type ?? input.kind);
  if (mediaType) parts.push(mediaType);

  const platform = normalizeListForFingerprint(input.platforms ?? input.platform ?? input.platformGroup ?? input.system);
  if (platform) parts.push(platform);

  const format = normalizeListForFingerprint(input.format ?? input.formatGroup ?? input.edition ?? input.variant);
  if (format) parts.push(format);

  return sha1FromString(parts.join('|'));
}

function makeLightweightFingerprint(options, maybeCreator) {
  let opts;
  if (typeof options === 'object' && options !== null && maybeCreator === undefined) {
    opts = options;
  } else {
    opts = { title: options, primaryCreator: maybeCreator };
  }

  if (opts?.uniqueKey) {
    const key = normalizeForFingerprint(opts.uniqueKey);
    if (key) {
      return sha1FromString(key);
    }
  }

  const title = normalizeForFingerprint(opts?.title);
  const creator = normalizeForFingerprint(
    opts?.primaryCreator ?? opts?.creator ?? opts?.author,
  );
  const parts = [title, creator];

  const mediaType = normalizeMediaTypeForFingerprint(opts?.mediaType ?? opts?.type ?? opts?.kind);
  if (mediaType) parts.push(mediaType);

  const platform = normalizeListForFingerprint(opts?.platforms ?? opts?.platform ?? opts?.system);
  if (platform) parts.push(platform);

  return sha1FromString(parts.join('|'));
}

function normalizeFingerprintComponent(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function makeVisionOcrFingerprint(title, creator, kind) {
  const normalizedTitle = normalizeFingerprintComponent(title);
  const normalizedCreator = normalizeFingerprintComponent(creator);
  const normalizedKind = normalizeFingerprintComponent(normalizeMediaTypeForFingerprint(kind));
  if (!normalizedTitle || !normalizedCreator) return null;
  const parts = [normalizedTitle, normalizedCreator];
  if (normalizedKind) parts.push(normalizedKind);
  return sha1FromString(parts.join('|'));
}

module.exports = {
  makeCollectableFingerprint,
  makeLightweightFingerprint,
  makeVisionOcrFingerprint,
  normalizeFingerprintComponent,
};
