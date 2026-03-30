const {
  normalizeCastName,
  normalizeCastMembers,
  extractTmdbLookup,
  buildBatchUpdate,
  parseRetryAfterMs,
  createTmdbRateLimiter,
} = require('../scripts/backfill-collectable-cast-members');

describe('backfill-collectable-cast-members helpers', () => {
  it('normalizes cast names for exact matching', () => {
    expect(normalizeCastName('  Tom   Hanks  ')).toBe('tom hanks');
  });

  it('normalizes TMDB cast payload to structured cast members', () => {
    const cast = normalizeCastMembers([
      { id: 31, name: 'Tom Hanks', character: 'Captain Miller', order: 0, profile_path: '/a.jpg' },
      { id: '44', name: ' Matt Damon ', character: '', order: '1', profile_path: null },
      { id: 99, name: '' },
    ]);

    expect(cast).toEqual([
      {
        personId: 31,
        name: 'Tom Hanks',
        nameNormalized: 'tom hanks',
        character: 'Captain Miller',
        order: 0,
        profilePath: '/a.jpg',
      },
      {
        personId: 44,
        name: 'Matt Damon',
        nameNormalized: 'matt damon',
        character: null,
        order: 1,
        profilePath: null,
      },
    ]);
  });

  it('extracts TMDB movie lookup from identifiers', () => {
    const lookup = extractTmdbLookup({
      kind: 'movies',
      identifiers: {
        tmdb: {
          movie: ['550'],
        },
      },
      externalId: null,
    });

    expect(lookup).toEqual({
      mediaType: 'movie',
      tmdbId: '550',
    });
  });

  it('extracts TMDB tv lookup from external id', () => {
    const lookup = extractTmdbLookup({
      kind: 'tv',
      identifiers: {},
      externalId: 'tmdb_tv:1396',
    });

    expect(lookup).toEqual({
      mediaType: 'tv',
      tmdbId: '1396',
    });
  });

  it('builds batched update SQL and values for cast members', () => {
    const update = buildBatchUpdate([
      { id: 10, castMembers: [{ name: 'A', nameNormalized: 'a' }] },
      { id: 11, castMembers: [{ name: 'B', nameNormalized: 'b' }] },
    ]);

    expect(update.text).toContain('UPDATE collectables');
    expect(update.text).toContain('VALUES ($1::int, $2::jsonb), ($3::int, $4::jsonb)');
    expect(update.values).toEqual([
      10,
      JSON.stringify([{ name: 'A', nameNormalized: 'a' }]),
      11,
      JSON.stringify([{ name: 'B', nameNormalized: 'b' }]),
    ]);
  });

  it('parses numeric Retry-After headers in seconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs('0.5')).toBe(500);
  });

  it('parses date Retry-After headers', () => {
    const now = Date.parse('2026-03-29T12:00:00Z');
    const retryAt = new Date(now + 3500).toUTCString();
    expect(parseRetryAfterMs(retryAt, now)).toBeGreaterThanOrEqual(3000);
    expect(parseRetryAfterMs(retryAt, now)).toBeLessThanOrEqual(4000);
  });

  it('returns null for invalid Retry-After header', () => {
    expect(parseRetryAfterMs('not-a-date-or-number')).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
  });

  it('creates limiter clamped to TMDB soft max', () => {
    const limiter = createTmdbRateLimiter(100);
    expect(limiter.requestsPerSecond).toBe(50);
    expect(limiter.minIntervalMs).toBe(20);
  });
});
