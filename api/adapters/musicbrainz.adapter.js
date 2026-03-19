const {
  makeCollectableFingerprint,
  makeLightweightFingerprint,
} = require('../services/collectables/fingerprint');

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
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

/**
 * Extract artist names from MusicBrainz artist-credit array.
 * Each element is either an artist-credit object (with .artist.name) or a join phrase string.
 * @param {Array} artistCredit
 * @returns {string[]}
 */
function extractArtistNames(artistCredit) {
  if (!Array.isArray(artistCredit)) return [];
  const names = [];
  for (const credit of artistCredit) {
    if (credit && typeof credit === 'object' && credit.artist) {
      const name = normalizeString(credit.name || credit.artist.name);
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * Transform a MusicBrainz release-group JSON object to a collectable-shaped payload.
 *
 * @param {object} releaseGroup - MusicBrainz release-group object (from lookup endpoint)
 * @param {object} [options]
 * @param {string} [options.lightweightFingerprint]
 * @param {Date}   [options.fetchedAt]
 * @returns {object|null}
 */
function musicbrainzReleaseGroupToCollectable(releaseGroup, options = {}) {
  if (!releaseGroup || !releaseGroup.id) return null;

  const title = normalizeString(releaseGroup.title) || null;
  const mbid = releaseGroup.id;

  // Artist credits
  const artistCredit = releaseGroup['artist-credit'] || [];
  const artistNames = uniqueStrings(extractArtistNames(artistCredit));
  const primaryCreator = artistNames[0] || null;

  // Year from first-release-date
  const firstReleaseDate = releaseGroup['first-release-date'] || null;
  const year = extractYear(firstReleaseDate);

  // Publisher: label name from first release's label-info (if available)
  const releases = Array.isArray(releaseGroup.releases) ? releaseGroup.releases : [];
  let publisher = null;
  if (releases.length > 0) {
    const firstRelease = releases[0];
    const labelInfo = Array.isArray(firstRelease['label-info']) ? firstRelease['label-info'] : [];
    if (labelInfo.length > 0 && labelInfo[0].label) {
      publisher = normalizeString(labelInfo[0].label.name) || null;
    }
  }

  // Tags
  const tags = uniqueStrings(
    (Array.isArray(releaseGroup.tags) ? releaseGroup.tags : []).map((t) => t && t.name)
  );

  // Genres
  const genre = uniqueStrings(
    (Array.isArray(releaseGroup.genres) ? releaseGroup.genres : []).map((g) => g && g.name)
  );

  // Identifiers
  const identifiers = {
    musicbrainz: {
      releaseGroup: [mbid],
    },
  };
  if (releases.length > 0 && releases[0].id) {
    identifiers.musicbrainz.release = [releases[0].id];
  }

  // Cover Art Archive URLs
  const coverUrlSmall = `https://coverartarchive.org/release-group/${mbid}/front-250`;
  const coverUrlMedium = `https://coverartarchive.org/release-group/${mbid}/front-500`;
  const coverUrlLarge = `https://coverartarchive.org/release-group/${mbid}/front`;

  const images = [
    {
      kind: 'cover',
      urlSmall: coverUrlSmall,
      urlMedium: coverUrlMedium,
      urlLarge: coverUrlLarge,
      provider: 'coverartarchive',
    },
  ];

  const fetchedAt = options.fetchedAt || new Date();

  const sources = [
    {
      provider: 'musicbrainz',
      ids: { releaseGroup: mbid },
      urls: {
        releaseGroup: `https://musicbrainz.org/release-group/${mbid}`,
        api: `https://musicbrainz.org/ws/2/release-group/${mbid}`,
      },
      fetchedAt,
    },
  ];

  const extras = {
    primaryType: releaseGroup['primary-type'] || null,
    secondaryTypes: releaseGroup['secondary-types'] || [],
    firstReleaseDate,
    rating: releaseGroup.rating || null,
  };

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
    description: normalizeString(releaseGroup.disambiguation) || null,
    primaryCreator,
    creators: artistNames,
    year: year || null,
    publisher,
    tags,
    genre,
    lightweightFingerprint: lightweightFingerprint || null,
    fingerprint: fingerprint || null,
    identifiers,
    images,
    sources,
    extras,

    // Provider-agnostic cover fields
    coverImageUrl: coverUrlMedium,
    coverImageSource: 'external',

    // Attribution
    attribution: {
      linkUrl: `https://musicbrainz.org/release-group/${mbid}`,
      linkText: 'View on MusicBrainz',
      logoKey: 'musicbrainz',
      disclaimerText:
        'This product uses the MusicBrainz API and is subject to the Creative Commons CC BY-NC-SA 3.0 license.',
    },
  };
}

module.exports = {
  musicbrainzReleaseGroupToCollectable,
};
