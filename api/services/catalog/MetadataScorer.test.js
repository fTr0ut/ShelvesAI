'use strict';

const { MetadataScorer, getMetadataScorer } = require('./MetadataScorer');
const { scoreBookCollectable } = require('./metadataScore');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFullBook(overrides = {}) {
  return {
    title: 'The Great Gatsby',
    primaryCreator: 'F. Scott Fitzgerald',
    publishers: ['Scribner'],
    year: '1925',
    description:
      'The Great Gatsby is a 1925 novel by American writer F. Scott Fitzgerald. Set in the Jazz Age on Long Island, near New York City, the novel depicts first-person narrator Nick Carraway interactions with mysterious millionaire Jay Gatsby.',
    coverImageUrl: 'https://example.com/cover.jpg',
    identifiers: { isbn13: '9780743273565' },
    tags: ['fiction', 'classic'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MetadataScorer — books backward compatibility
// ---------------------------------------------------------------------------

describe('MetadataScorer — books backward compatibility with scoreBookCollectable', () => {
  const scorer = new MetadataScorer();

  function compare(collectable, label) {
    const legacy = scoreBookCollectable(collectable);
    const { score, maxScore } = scorer.score(collectable, 'books');
    expect(score).toBe(legacy.score);
    expect(maxScore).toBe(legacy.maxScore);
  }

  it('scores a fully-populated book identically', () => {
    compare(buildFullBook());
  });

  it('scores a book with no fields identically (all missing)', () => {
    compare({});
  });

  it('scores a book with only title', () => {
    compare({ title: 'Only Title' });
  });

  it('scores a book with primaryAuthor instead of primaryCreator', () => {
    compare(buildFullBook({ primaryCreator: undefined, primaryAuthor: 'Author Name' }));
  });

  it('scores a book with author field instead of primaryCreator', () => {
    compare(buildFullBook({ primaryCreator: undefined, author: 'Author Name' }));
  });

  it('scores a book with creators array', () => {
    compare(buildFullBook({ primaryCreator: undefined, creators: ['Author A', 'Author B'] }));
  });

  it('scores a book with publisher string instead of publishers array', () => {
    compare(buildFullBook({ publishers: undefined, publisher: 'Scribner' }));
  });

  it('scores a book with publishersDetailed', () => {
    compare(buildFullBook({ publishers: undefined, publishersDetailed: ['Scribner'] }));
  });

  it('scores a book with publishYear instead of year', () => {
    compare(buildFullBook({ year: undefined, publishYear: '1925' }));
  });

  it('scores a book with releaseYear instead of year', () => {
    compare(buildFullBook({ year: undefined, releaseYear: '1925' }));
  });

  it('awards partial description score (40-119 chars)', () => {
    const desc = 'A'.repeat(60); // 60 chars — partial
    compare(buildFullBook({ description: desc }));
  });

  it('awards no description score (< 40 chars)', () => {
    compare(buildFullBook({ description: 'Short' }));
  });

  it('awards no description score when missing', () => {
    compare(buildFullBook({ description: undefined }));
  });

  it('scores cover via coverImage field', () => {
    compare(buildFullBook({ coverImageUrl: undefined, coverImage: 'https://example.com/img.jpg' }));
  });

  it('scores cover via coverUrl field', () => {
    compare(buildFullBook({ coverImageUrl: undefined, coverUrl: 'https://example.com/img.jpg' }));
  });

  it('scores cover via images array', () => {
    compare(
      buildFullBook({
        coverImageUrl: undefined,
        images: [{ urlLarge: 'https://example.com/large.jpg' }],
      })
    );
  });

  it('awards fallback identifier score for openlibrary', () => {
    compare(
      buildFullBook({
        identifiers: { openlibrary: 'OL123M' },
      })
    );
  });

  it('awards fallback identifier score for hardcover', () => {
    compare(
      buildFullBook({
        identifiers: { hardcover: 'HC456' },
      })
    );
  });

  it('awards no identifier score when identifiers is empty', () => {
    compare(buildFullBook({ identifiers: {} }));
  });

  it('scores tags via genre field', () => {
    compare(buildFullBook({ tags: undefined, genre: ['fiction'] }));
  });

  it('scores isbn10 as preferred identifier', () => {
    compare(buildFullBook({ identifiers: { isbn10: '0743273567' } }));
  });

  it('scores asin as preferred identifier', () => {
    compare(buildFullBook({ identifiers: { asin: 'B000FC1PJI' } }));
  });
});

// ---------------------------------------------------------------------------
// MetadataScorer — null/non-object input
// ---------------------------------------------------------------------------

describe('MetadataScorer — null/non-object input via scoreBookCollectable wrapper', () => {
  it('returns score 0 and missing collectable for null input', () => {
    const result = scoreBookCollectable(null);
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(100);
    expect(result.missing).toContain('collectable');
  });

  it('returns score 0 and missing collectable for string input', () => {
    const result = scoreBookCollectable('not an object');
    expect(result.score).toBe(0);
    expect(result.missing).toContain('collectable');
  });
});

// ---------------------------------------------------------------------------
// MetadataScorer — score() return shape
// ---------------------------------------------------------------------------

describe('MetadataScorer.score() return shape', () => {
  const scorer = new MetadataScorer();

  it('returns scoredAt as ISO string', () => {
    const { scoredAt } = scorer.score(buildFullBook(), 'books');
    expect(typeof scoredAt).toBe('string');
    expect(() => new Date(scoredAt)).not.toThrow();
    expect(new Date(scoredAt).toISOString()).toBe(scoredAt);
  });

  it('returns null score for unknown container type', () => {
    const result = scorer.score(buildFullBook(), 'unknown_type');
    expect(result.score).toBeNull();
    expect(result.maxScore).toBeNull();
    expect(result.missing).toEqual([]);
    expect(typeof result.scoredAt).toBe('string');
  });

  it('returns score and maxScore for known type', () => {
    const result = scorer.score(buildFullBook(), 'books');
    expect(typeof result.score).toBe('number');
    expect(result.maxScore).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// MetadataScorer — getMinScore
// ---------------------------------------------------------------------------

describe('MetadataScorer.getMinScore()', () => {
  const scorer = new MetadataScorer();

  it('returns 55 for books', () => {
    expect(scorer.getMinScore('books')).toBe(55);
  });

  it('returns 45 for vinyl', () => {
    expect(scorer.getMinScore('vinyl')).toBe(45);
  });

  it('returns 50 for movies', () => {
    expect(scorer.getMinScore('movies')).toBe(50);
  });

  it('returns 45 for games', () => {
    expect(scorer.getMinScore('games')).toBe(45);
  });

  it('returns 50 for tv', () => {
    expect(scorer.getMinScore('tv')).toBe(50);
  });

  it('returns null for unknown type', () => {
    expect(scorer.getMinScore('unknown')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MetadataScorer — meetsThreshold
// ---------------------------------------------------------------------------

describe('MetadataScorer.meetsThreshold()', () => {
  const scorer = new MetadataScorer();

  it('returns true for a fully-populated book (score >= 55)', () => {
    expect(scorer.meetsThreshold(buildFullBook(), 'books')).toBe(true);
  });

  it('returns false for an empty book (score 0 < 55)', () => {
    expect(scorer.meetsThreshold({}, 'books')).toBe(false);
  });

  it('returns true for unknown container type (no opinion)', () => {
    expect(scorer.meetsThreshold({}, 'unknown_type')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MetadataScorer — configOverride
// ---------------------------------------------------------------------------

describe('MetadataScorer — configOverride', () => {
  it('uses the provided config instead of the file', () => {
    const customConfig = {
      custom: {
        minScore: 10,
        maxScore: 50,
        fields: [{ field: 'title', check: 'hasString', weight: 50 }],
      },
    };
    const scorer = new MetadataScorer({ configOverride: customConfig });
    const result = scorer.score({ title: 'Hello' }, 'custom');
    expect(result.score).toBe(50);
    expect(result.maxScore).toBe(50);
    expect(result.missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MetadataScorer — scoreAsync()
// ---------------------------------------------------------------------------

describe('MetadataScorer.scoreAsync()', () => {
  function buildFullBook(overrides = {}) {
    return {
      title: 'The Great Gatsby',
      primaryCreator: 'F. Scott Fitzgerald',
      publishers: ['Scribner'],
      year: '1925',
      description:
        'The Great Gatsby is a 1925 novel by American writer F. Scott Fitzgerald. Set in the Jazz Age on Long Island, near New York City, the novel depicts first-person narrator Nick Carraway interactions with mysterious millionaire Jay Gatsby.',
      coverImageUrl: 'https://example.com/cover.jpg',
      identifiers: { isbn13: '9780743273565' },
      tags: ['fiction', 'classic'],
      ...overrides,
    };
  }

  it('falls back to static config when no settingsCache is provided', async () => {
    const scorer = new MetadataScorer();
    const book = buildFullBook();
    const asyncResult = await scorer.scoreAsync(book, 'books');
    const syncResult = scorer.score(book, 'books');

    expect(asyncResult.score).toBe(syncResult.score);
    expect(asyncResult.maxScore).toBe(syncResult.maxScore);
  });

  it('falls back to static config when cache returns null', async () => {
    const mockCache = { get: jest.fn().mockResolvedValue(null) };
    const scorer = new MetadataScorer({ settingsCache: mockCache });
    const book = buildFullBook();

    const asyncResult = await scorer.scoreAsync(book, 'books');
    const syncResult = scorer.score(book, 'books');

    expect(asyncResult.score).toBe(syncResult.score);
    expect(mockCache.get).toHaveBeenCalledWith('metadata_score_config');
  });

  it('uses DB config override when cache returns a config for the container type', async () => {
    const dbConfig = {
      books: {
        minScore: 10,
        maxScore: 50,
        fields: [{ field: 'title', check: 'hasString', weight: 50 }],
      },
    };
    const mockCache = { get: jest.fn().mockResolvedValue(dbConfig) };
    const scorer = new MetadataScorer({ settingsCache: mockCache });

    const result = await scorer.scoreAsync({ title: 'Hello' }, 'books');

    expect(result.score).toBe(50);
    expect(result.maxScore).toBe(50);
  });

  it('falls back to static config when DB config does not have the container type', async () => {
    const dbConfig = { other_type: {} }; // no 'books' key
    const mockCache = { get: jest.fn().mockResolvedValue(dbConfig) };
    const scorer = new MetadataScorer({ settingsCache: mockCache });
    const book = buildFullBook();

    const asyncResult = await scorer.scoreAsync(book, 'books');
    const syncResult = scorer.score(book, 'books');

    expect(asyncResult.score).toBe(syncResult.score);
  });

  it('falls back to static config when cache.get() throws', async () => {
    const mockCache = { get: jest.fn().mockRejectedValue(new Error('DB down')) };
    const scorer = new MetadataScorer({ settingsCache: mockCache });
    const book = buildFullBook();

    const asyncResult = await scorer.scoreAsync(book, 'books');
    const syncResult = scorer.score(book, 'books');

    expect(asyncResult.score).toBe(syncResult.score);
  });

  it('returns same shape as score() (score, maxScore, missing, scoredAt)', async () => {
    const scorer = new MetadataScorer();
    const result = await scorer.scoreAsync(buildFullBook(), 'books');

    expect(typeof result.score).toBe('number');
    expect(typeof result.maxScore).toBe('number');
    expect(Array.isArray(result.missing)).toBe(true);
    expect(typeof result.scoredAt).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// MetadataScorer — missing array
// ---------------------------------------------------------------------------

describe('getMetadataScorer() singleton', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getMetadataScorer();
    const b = getMetadataScorer();
    expect(a).toBe(b);
  });

  it('returns a MetadataScorer instance', () => {
    expect(getMetadataScorer()).toBeInstanceOf(MetadataScorer);
  });
});

// ---------------------------------------------------------------------------
// MetadataScorer — check functions for non-book types
// ---------------------------------------------------------------------------

describe('MetadataScorer — movies scoring', () => {
  const scorer = new MetadataScorer();

  it('scores a fully-populated movie', () => {
    const movie = {
      title: 'Inception',
      primaryCreator: 'Christopher Nolan',
      year: '2010',
      description:
        'A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O., but his tragic past may doom the project and his team to disaster.',
      coverImageUrl: 'https://example.com/inception.jpg',
      identifiers: { tmdb: '27205' },
      tags: ['action', 'sci-fi'],
      runtime: 148,
      extras: { certification: 'PG-13' },
    };
    const { score, maxScore } = scorer.score(movie, 'movies');
    expect(score).toBe(maxScore); // all fields present
    expect(maxScore).toBe(100);
  });

  it('awards partial description score for movies', () => {
    const movie = {
      title: 'Inception',
      description: 'A'.repeat(60), // 60 chars — partial (>= 40)
    };
    const { score } = scorer.score(movie, 'movies');
    // title (15) + partial description (10) = 25
    expect(score).toBe(25);
  });

  it('checks hasNestedValue for extras.certification', () => {
    const movie = { title: 'Test', extras: { certification: 'PG-13' } };
    const { score } = scorer.score(movie, 'movies');
    // title (15) + extras.certification (5) = 20
    expect(score).toBe(20);
  });

  it('returns 0 for extras.certification when extras is missing', () => {
    const movie = { title: 'Test' };
    const { score } = scorer.score(movie, 'movies');
    expect(score).toBe(15); // only title
  });
});

describe('MetadataScorer — tv scoring', () => {
  const scorer = new MetadataScorer();

  it('checks hasNestedString for extras.status', () => {
    const show = {
      title: 'Breaking Bad',
      extras: { status: 'Ended', numberOfSeasons: 5 },
    };
    const { score } = scorer.score(show, 'tv');
    // title (15) + extras.numberOfSeasons (5) + extras.status (5) = 25
    expect(score).toBe(25);
  });

  it('does not award extras.status for empty string', () => {
    const show = {
      title: 'Breaking Bad',
      extras: { status: '' },
    };
    const { score } = scorer.score(show, 'tv');
    expect(score).toBe(15); // only title
  });
});

describe('MetadataScorer — games scoring', () => {
  const scorer = new MetadataScorer();

  it('awards systemName weight for hasString check', () => {
    const game = { title: 'Mario', systemName: 'Nintendo Switch' };
    const { score } = scorer.score(game, 'games');
    // title (20) + systemName (10) = 30
    expect(score).toBe(30);
  });
});

describe('MetadataScorer — missing array', () => {
  const scorer = new MetadataScorer();

  it('includes field name in missing when check fails', () => {
    const { missing } = scorer.score({}, 'books');
    expect(missing).toContain('title');
    expect(missing).toContain('primaryCreator');
    expect(missing).toContain('publishers');
    expect(missing).toContain('year');
    expect(missing).toContain('description');
    expect(missing).toContain('coverImage');
    expect(missing).toContain('identifiers');
    expect(missing).toContain('tags');
  });

  it('does not include field in missing when partial credit is awarded (stringMinLength)', () => {
    const book = buildFullBook({ description: 'A'.repeat(60) }); // partial
    const { missing } = scorer.score(book, 'books');
    expect(missing).not.toContain('description');
  });

  it('does not include identifiers in missing when fallback credit is awarded', () => {
    const book = buildFullBook({ identifiers: { openlibrary: 'OL123M' } });
    const { missing } = scorer.score(book, 'books');
    expect(missing).not.toContain('identifiers');
  });
});
