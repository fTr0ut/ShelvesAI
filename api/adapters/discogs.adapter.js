const {
  makeCollectableFingerprint,
  makeLightweightFingerprint,
} = require('../services/collectables/fingerprint');

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function cleanArtistName(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return normalized.replace(/\s+\(\d+\)$/, '').trim();
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function extractYear(value) {
  if (!value) return null;
  const match = String(value).match(/\b(\d{4})\b/);
  return match ? match[1] : null;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function isMaster(payload) {
  return String(payload?.resource_url || '').includes('/masters/');
}

function extractArtists(payload = {}) {
  const artists = toArray(payload.artists)
    .map((artist) => cleanArtistName(artist?.name || artist))
    .filter(Boolean);

  if (artists.length) return uniqueStrings(artists);

  const fromTitle = normalizeString(payload.title);
  if (fromTitle.includes(' - ')) {
    const [artistPart] = fromTitle.split(' - ');
    const candidate = cleanArtistName(artistPart);
    if (candidate) return [candidate];
  }

  return [];
}

function extractTitle(payload = {}) {
  const title = normalizeString(payload.title);
  if (!title) return '';

  if (title.includes(' - ')) {
    const [, maybeTitle] = title.split(' - ');
    if (normalizeString(maybeTitle)) return normalizeString(maybeTitle);
  }

  return title;
}

function extractImageSet(payload = {}) {
  const images = [];
  const detailsImages = Array.isArray(payload.images) ? payload.images : [];

  for (const image of detailsImages) {
    const url = normalizeString(image?.uri || image?.resource_url || image?.uri150);
    if (!url) continue;
    images.push({
      kind: image?.type === 'secondary' ? 'artwork' : 'cover',
      urlLarge: normalizeString(image?.uri || image?.resource_url) || null,
      urlMedium:
        normalizeString(image?.resource_url || image?.uri || image?.uri150) || null,
      urlSmall: normalizeString(image?.uri150 || image?.resource_url || image?.uri) || null,
      provider: 'discogs',
    });
  }

  if (!images.length && normalizeString(payload.cover_image)) {
    const cover = normalizeString(payload.cover_image);
    images.push({
      kind: 'cover',
      urlLarge: cover,
      urlMedium: cover,
      urlSmall: cover,
      provider: 'discogs',
    });
  }

  return images;
}

function extractIdentifiers(payload = {}, resultMeta = {}) {
  const identifiers = { discogs: {} };
  const payloadType = isMaster(payload) ? 'master' : 'release';
  const payloadId = payload?.id;

  if (payloadId != null) {
    identifiers.discogs[payloadType] = [String(payloadId)];
  }

  if (resultMeta.masterId != null) {
    identifiers.discogs.master = uniqueStrings([
      ...(identifiers.discogs.master || []),
      String(resultMeta.masterId),
    ]);
  }

  if (resultMeta.releaseId != null) {
    identifiers.discogs.release = uniqueStrings([
      ...(identifiers.discogs.release || []),
      String(resultMeta.releaseId),
    ]);
  }

  const catalogNumbers = uniqueStrings(
    toArray(payload.labels)
      .map((label) => label?.catno)
      .filter(Boolean),
  );
  if (catalogNumbers.length) {
    identifiers.discogs.catalogNumber = catalogNumbers;
  }

  const barcodes = uniqueStrings(
    toArray(payload.identifiers)
      .filter((entry) => normalizeString(entry?.type).toLowerCase() === 'barcode')
      .map((entry) => entry?.value)
      .filter(Boolean),
  );
  if (barcodes.length) {
    identifiers.barcode = barcodes;
  }

  return identifiers;
}

function discogsToCollectable(payload, options = {}) {
  if (!payload || payload.id == null) return null;

  const title = extractTitle(payload);
  const creators = extractArtists(payload);
  const primaryCreator = creators[0] || null;
  const year = extractYear(payload.year);

  const labels = uniqueStrings(toArray(payload.labels).map((entry) => entry?.name));
  const publisher = labels[0] || null;

  const genre = uniqueStrings([
    ...toArray(payload.genres),
    ...toArray(payload.styles),
  ]);

  const tags = uniqueStrings([
    ...toArray(payload.styles),
    ...toArray(payload.formats)
      .flatMap((format) => [format?.name, ...(Array.isArray(format?.descriptions) ? format.descriptions : [])])
      .filter(Boolean),
  ]);

  const images = extractImageSet(payload);
  const coverImageUrl =
    normalizeString(images[0]?.urlMedium || images[0]?.urlLarge || images[0]?.urlSmall) ||
    null;

  const sourceUrl = normalizeString(
    options.sourceUrl || payload.uri || payload.resource_url || '',
  );
  const resultMeta = options.resultMeta || {};
  const identifiers = extractIdentifiers(payload, resultMeta);

  const lightweightFingerprint = options.lightweightFingerprint
    ? options.lightweightFingerprint
    : makeLightweightFingerprint({ title, primaryCreator, kind: 'album' });

  const fingerprint = makeCollectableFingerprint({
    title,
    primaryCreator,
    releaseYear: year,
    mediaType: 'album',
  });

  return {
    kind: 'album',
    type: 'album',
    title: title || '',
    description: normalizeString(payload.notes || payload.data_quality) || null,
    primaryCreator,
    creators,
    year: year || null,
    publisher,
    publishers: labels,
    tags,
    genre,
    lightweightFingerprint: lightweightFingerprint || null,
    fingerprint: fingerprint || null,
    identifiers,
    images,
    sources: [
      {
        provider: 'discogs',
        ids: {
          release: (identifiers.discogs && identifiers.discogs.release) || [],
          master: (identifiers.discogs && identifiers.discogs.master) || [],
        },
        urls: {
          page: sourceUrl || null,
          api: normalizeString(payload.resource_url) || null,
        },
        fetchedAt: options.fetchedAt || new Date(),
      },
    ],
    extras: {
      country: normalizeString(payload.country) || null,
      formats: toArray(payload.formats).map((format) => ({
        name: normalizeString(format?.name) || null,
        qty: normalizeString(format?.qty) || null,
        descriptions: toArray(format?.descriptions).map((value) => normalizeString(value)),
      })),
      discogs: {
        dataQuality: normalizeString(payload.data_quality) || null,
        type: isMaster(payload) ? 'master' : 'release',
      },
    },
    coverImageUrl,
    coverImageSource: 'external',
    attribution: {
      linkUrl: sourceUrl || null,
      linkText: 'View on Discogs',
      logoKey: 'discogs',
      disclaimerText: 'Data provided by Discogs.',
    },
  };
}

module.exports = {
  discogsToCollectable,
};
