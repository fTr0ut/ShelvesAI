// adapters/openlibrary.adapter.js
const crypto = require('crypto');

function unique(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function makeFingerprint({ title, primaryCreator, year }) {
  const base = [title?.trim().toLowerCase() || '',
                primaryCreator?.trim().toLowerCase() || '',
                year || ''].join('|');
  return crypto.createHash('sha1').update(base).digest('hex');
}

function makeLightweightFingerprint(title, creator) {
  const base = [
    (title || '').trim().toLowerCase(),
    (creator || '').trim().toLowerCase(),
  ].join('|');
  return crypto.createHash('sha1').update(base).digest('hex');
}

/**
 * h = hydrated Work from your openLibrary.js (searchAndHydrateBooks / lookupWorkBookMetadata)
 */
function openLibraryToCollectable(h) {
  if (!h?.workId) return null;

  const primaryCreator =
    (h.authorsDetailed && h.authorsDetailed[0]?.name) ||
    (Array.isArray(h.authors) && h.authors[0]) ||
    null;

  const year =
    h.publishYear ||
    (h.edition?.publish_date ? (String(h.edition.publish_date).match(/\b(\d{4})\b/)?.[1] || null) : null);

    const identifiers = {
        openlibrary: {
            work: [h.workId],
            ...(h.edition?.id ? { edition: [h.edition.id] } : {}),
        },
        };

        if (Array.isArray(h.edition?.isbn_13) && h.edition.isbn_13.length) {
        identifiers.isbn13 = unique(h.edition.isbn_13);
        }
        if (Array.isArray(h.edition?.isbn_10) && h.edition.isbn_10.length) {
        identifiers.isbn10 = unique(h.edition.isbn_10);
    }


  const sources = [{
    provider: 'openlibrary',
    ids: {
    work: h.workId,
    ...(h.edition?.id ? { edition: h.edition.id } : {}),
        },
    urls: {
    work: h.openLibraryUrls?.work || null,
    workJson: h.openLibraryUrls?.workJson || null,
    edition: h.openLibraryUrls?.edition || null,
    editionJson: h.openLibraryUrls?.editionJson || null,
         },
    fetchedAt: new Date(),
  }];

  const images = [];
  if (h.coverUrls?.small || h.coverUrls?.medium || h.coverUrls?.large) {
    images.push({
      kind: 'cover',
      urlSmall: h.coverUrls.small || null,
      urlMedium: h.coverUrls.medium || null,
      urlLarge: h.coverUrls.large || null,
      provider: 'openlibrary',
    });
  }

  const editions = [];
  if (h.edition) {
    editions.push({
      provider: 'openlibrary',
      id: h.edition.id || null,
      title: h.edition.title || h.title || null,
      subtitle: h.edition.subtitle || null,
      labelOrPublisher: h.edition.publishers || [],
      dateOrYear: h.edition.publish_date || null,
      identifiers: new Map(Object.entries({
        isbn10: h.edition.isbn_10 || [],
        isbn13: h.edition.isbn_13 || [],
      })),
      physical: {
        format: h.edition.physical_format || null,
        pages: h.edition.number_of_pages || null,
        weight: h.edition.weight || null,
        dimensions: null,
        languages: Array.isArray(h.edition.languages) ? h.edition.languages : [],
        extras: {},
      },
    });
  }

  const lwf = h.lightweightFingerprint || makeLightweightFingerprint(h.title, primaryCreator);

  const doc = {
    kind: 'book',
    title: h.title || '',
    subtitle: h.subtitle || null,
    description: h.description || null,

    primaryCreator,
    creators: unique(
      (h.authorsDetailed && h.authorsDetailed.map(a => a?.name).filter(Boolean)) || h.authors || []
    ),

    year,

    tags: unique(h.subjects || []),

    lightweightFingerprint: lwf || null,

    images,
    identifiers,
    physical: {
      format: h.edition?.physical_format || null,
      pages: h.edition?.number_of_pages || null,
      weight: h.edition?.weight || null,
      dimensions: null,
      languages: Array.isArray(h.edition?.languages) ? h.edition.languages : [],
      extras: {},
    },

    editions,
    sources,

    fingerprint: makeFingerprint({ title: h.title, primaryCreator, year }),
    extras: {},
  };

  return doc;
}

module.exports = { openLibraryToCollectable };
