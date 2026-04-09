jest.mock('../database/pg', () => ({
  query: jest.fn(),
}));

const { query } = require('../database/pg');
const { resolveMediaUrl } = require('../services/mediaUrl');
const collectablesRoute = require('../routes/collectables');

const {
  normalizeExplicitType,
  normalizeApiContainerType,
  parseFallbackLimit,
  computeFallbackFetchLimit,
  parseStructuredQueryForCreator,
  buildApiLookupInputs,
  resolveApiContainerForSearch,
  buildCollectableUpsertPayloadFromCandidate,
  includeCastPayload,
  buildCollectableResponsePayload,
} = collectablesRoute._helpers;

describe('collectables route helpers', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('normalizes explicit search type and treats "all" as empty', () => {
    expect(normalizeExplicitType('all')).toBe('');
    expect(normalizeExplicitType('movie')).toBe('movies');
    expect(normalizeExplicitType('')).toBe('');
  });

  it('normalizes API container type aliases', () => {
    expect(normalizeApiContainerType('book')).toBe('books');
    expect(normalizeApiContainerType('xbox')).toBe('games');
    expect(normalizeApiContainerType('other')).toBeNull();
  });

  it('parses fallback limit with sane defaults/caps', () => {
    expect(parseFallbackLimit(undefined)).toBe(3);
    expect(parseFallbackLimit('2')).toBe(2);
    expect(parseFallbackLimit('99')).toBe(50);
    expect(parseFallbackLimit('-1')).toBe(3);
  });

  it('computes fallback fetch limit for paged API requests', () => {
    expect(computeFallbackFetchLimit({ fallbackLimit: 3, limit: 20 })).toBe(3);
    expect(computeFallbackFetchLimit({ fallbackLimit: 50, limit: 20 })).toBe(21);
    expect(computeFallbackFetchLimit({ fallbackLimit: 50, limit: 30 })).toBe(31);
    expect(computeFallbackFetchLimit({ fallbackLimit: 100, limit: 50 })).toBe(50);
  });

  it('parses structured title + creator query text', () => {
    expect(parseStructuredQueryForCreator('Dune by Frank Herbert')).toEqual({
      title: 'Dune',
      creator: 'Frank Herbert',
    });
    expect(parseStructuredQueryForCreator('Alien directed by Ridley Scott')).toEqual({
      title: 'Alien',
      creator: 'Ridley Scott',
    });
    expect(parseStructuredQueryForCreator('No delimiter here')).toBeNull();
  });

  it('builds API lookup inputs for typed creator/title search', () => {
    const structuredInputs = buildApiLookupInputs({
      queryText: 'Dune by Frank Herbert',
      resolvedContainer: 'books',
    });
    expect(structuredInputs).toHaveLength(1);
    expect(structuredInputs[0]).toMatchObject({
      title: 'Dune',
      author: 'Frank Herbert',
      primaryCreator: 'Frank Herbert',
    });

    const creatorOnlyCapableInputs = buildApiLookupInputs({
      queryText: 'Frank Herbert',
      resolvedContainer: 'books',
    });
    expect(creatorOnlyCapableInputs).toHaveLength(2);
    expect(creatorOnlyCapableInputs[0]).toMatchObject({ title: 'Frank Herbert' });
    expect(creatorOnlyCapableInputs[1]).toMatchObject({
      title: '',
      author: 'Frank Herbert',
      primaryCreator: 'Frank Herbert',
    });

    const movieInputs = buildApiLookupInputs({
      queryText: 'Christopher Nolan',
      resolvedContainer: 'movies',
    });
    expect(movieInputs).toHaveLength(2);
    expect(movieInputs[0]).toMatchObject({ title: 'Christopher Nolan' });
    expect(movieInputs[1]).toMatchObject({
      title: '',
      author: 'Christopher Nolan',
      primaryCreator: 'Christopher Nolan',
    });

    const nonCreatorOnlyInputs = buildApiLookupInputs({
      queryText: 'Some Query',
      resolvedContainer: 'tv',
    });
    expect(nonCreatorOnlyInputs).toHaveLength(1);
    expect(nonCreatorOnlyInputs[0]).toMatchObject({ title: 'Some Query' });

    const gameInputsWithPlatform = buildApiLookupInputs({
      queryText: 'Halo',
      resolvedContainer: 'games',
      platform: 'Xbox',
    });
    expect(gameInputsWithPlatform).toHaveLength(2);
    expect(gameInputsWithPlatform[0]).toMatchObject({
      title: 'Halo',
      platform: 'Xbox',
      systemName: 'Xbox',
    });

    const movieInputsIgnoringPlatform = buildApiLookupInputs({
      queryText: 'Inception',
      resolvedContainer: 'movies',
      platform: 'Xbox',
    });
    expect(movieInputsIgnoringPlatform).toHaveLength(2);
    expect(movieInputsIgnoringPlatform[0].platform).toBeUndefined();
  });

  it('resolves API container from explicit type first', async () => {
    const result = await resolveApiContainerForSearch({
      explicitType: 'movies',
      queryText: 'halo',
      userId: 'user-1',
    });
    expect(result).toBe('movies');
    expect(query).not.toHaveBeenCalled();
  });

  it('resolves API container from query aliases when type is all', async () => {
    const result = await resolveApiContainerForSearch({
      explicitType: '',
      queryText: 'xbox halo',
      userId: 'user-1',
    });
    expect(result).toBe('games');
    expect(query).not.toHaveBeenCalled();
  });

  it('resolves API container from dominant user shelf type when query is ambiguous', async () => {
    query.mockResolvedValueOnce({ rows: [{ type: 'vinyl', count: 12 }] });
    const result = await resolveApiContainerForSearch({
      explicitType: '',
      queryText: 'the thing',
      userId: 'user-1',
    });
    expect(result).toBe('vinyl');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('falls back to books when no explicit/query/dominant type is available', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await resolveApiContainerForSearch({
      explicitType: '',
      queryText: 'the thing',
      userId: 'user-1',
    });
    expect(result).toBe('books');
  });

  it('builds collectable upsert payload from tapped API candidate', () => {
    const payload = buildCollectableUpsertPayloadFromCandidate(
      {
        title: 'Dune',
        primaryCreator: 'Frank Herbert',
        kind: 'books',
        provider: 'openlibrary',
        castMembers: [
          { id: 1, name: 'Timothee Chalamet', character: 'Paul Atreides', order: 0, profile_path: '/p.jpg' },
        ],
      },
      'books',
    );
    expect(payload).toBeTruthy();
    expect(payload.title).toBe('Dune');
    expect(payload.primaryCreator).toBe('Frank Herbert');
    expect(payload.kind).toBe('books');
    expect(payload.fingerprint).toBeTruthy();
    expect(payload.lightweightFingerprint).toBeTruthy();
    expect(payload.sources).toContain('openlibrary');
    expect(payload.castMembers).toEqual([
      {
        personId: 1,
        name: 'Timothee Chalamet',
        nameNormalized: 'timothee chalamet',
        character: 'Paul Atreides',
        order: 0,
        profilePath: '/p.jpg',
      },
    ]);
  });

  it('maps game candidate system/platform data into collectable upsert payload', () => {
    const payload = buildCollectableUpsertPayloadFromCandidate(
      {
        title: 'Halo Infinite',
        kind: 'games',
        systemName: 'Xbox Series X',
        maxPlayers: 16,
        _metadataScore: 72,
        _metadataMaxScore: 100,
        _metadataMissing: ['description'],
        _metadataScoredAt: '2026-03-31T00:00:00.000Z',
        metascore: { provider: 'igdb', rating: 88.1, ratingCount: 1000 },
        igdbPayload: {
          fetchedAt: '2026-03-31T00:00:00.000Z',
          score: 321,
          game: { id: 99, name: 'Halo Infinite' },
        },
        platformData: [
          { provider: 'igdb', igdbPlatformId: 169, name: 'Xbox Series X|S', abbreviation: 'XSX' },
          { provider: 'igdb', igdbPlatformId: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' },
        ],
      },
      'games',
    );

    expect(payload.systemName).toBe('Xbox Series X');
    expect(payload.platformData).toEqual([
      expect.objectContaining({ igdbPlatformId: 169, name: 'Xbox Series X|S', abbreviation: 'XSX' }),
      expect.objectContaining({ igdbPlatformId: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' }),
    ]);
    expect(payload.metascore).toEqual({
      score: 72,
      maxScore: 100,
      missing: ['description'],
      scoredAt: '2026-03-31T00:00:00.000Z',
    });
    expect(payload.maxPlayers).toBe(16);
    expect(payload.igdbPayload).toEqual(expect.objectContaining({
      score: 321,
      game: expect.objectContaining({ id: 99, name: 'Halo Infinite' }),
    }));
  });

  it('ignores provider ratings when candidate metascore is not metadata-score shaped', () => {
    const payload = buildCollectableUpsertPayloadFromCandidate(
      {
        title: 'Halo Infinite',
        kind: 'games',
        metascore: { provider: 'igdb', rating: 88.1, ratingCount: 1000 },
      },
      'games',
    );

    expect(payload.metascore).toBeNull();
  });

  it('includes cast list in payload when cast members are provided', () => {
    const payload = includeCastPayload({
      id: 7,
      title: 'Dune',
      castMembers: [
        { personId: 1, name: 'Timothee Chalamet', character: 'Paul', order: 0, profilePath: '/a.jpg' },
        { personId: 2, name: 'Zendaya', character: 'Chani', order: 1, profilePath: '/b.jpg' },
      ],
    });

    expect(payload.cast).toEqual(['Timothee Chalamet', 'Zendaya']);
    expect(payload.castMembers).toEqual([
      {
        personId: 1,
        name: 'Timothee Chalamet',
        nameNormalized: 'timothee chalamet',
        character: 'Paul',
        order: 0,
        profilePath: '/a.jpg',
      },
      {
        personId: 2,
        name: 'Zendaya',
        nameNormalized: 'zendaya',
        character: 'Chani',
        order: 1,
        profilePath: '/b.jpg',
      },
    ]);
  });

  it('builds response payload without market value sources and with normalized cast', () => {
    const payload = buildCollectableResponsePayload({
      id: 8,
      title: 'Inception',
      marketValue: '$20',
      marketValueSources: [{ url: 'https://example.com' }],
      igdbPayload: { game: { id: 1 } },
      cast: [{ name: 'Leonardo DiCaprio' }, 'Joseph Gordon-Levitt', 'Joseph Gordon-Levitt'],
    });

    expect(payload.marketValueSources).toBeUndefined();
    expect(payload.igdbPayload).toBeUndefined();
    expect(payload.cast).toEqual(['Leonardo DiCaprio', 'Joseph Gordon-Levitt']);
    expect(payload.castMembers).toEqual([]);
  });

  it('builds response payload with normalized platformData and derived platforms', () => {
    const payload = buildCollectableResponsePayload({
      id: 9,
      title: 'Halo Infinite',
      system_name: 'Xbox Series X',
      platform_data: [
        { provider: 'igdb', igdb_platform_id: 169, name: 'Xbox Series X|S', abbreviation: 'XSX' },
      ],
    });

    expect(payload.systemName).toBe('Xbox Series X');
    expect(payload.platformData).toEqual([
      expect.objectContaining({ igdbPlatformId: 169, name: 'Xbox Series X|S', abbreviation: 'XSX' }),
    ]);
    expect(payload.platforms).toEqual(['Xbox Series X|S', 'XSX', 'Xbox Series X']);
  });

  it('builds response payload with resolved coverMediaUrl when coverMediaPath exists', () => {
    const payload = buildCollectableResponsePayload({
      id: 13,
      title: 'Atmosphere: A Love Story',
      coverMediaPath: 'books/Atmosphere_A_Love_Story/abc123.jpg',
    });

    expect(payload.coverMediaPath).toBe('books/Atmosphere_A_Love_Story/abc123.jpg');
    expect(payload.coverMediaUrl).toBe(resolveMediaUrl('books/Atmosphere_A_Love_Story/abc123.jpg'));
  });

  it('surfaces maxPlayers directly from source multiplayer metadata', () => {
    const payload = buildCollectableResponsePayload({
      id: 10,
      kind: 'games',
      title: 'Mario Kart 8 Deluxe',
      sources: [
        {
          provider: 'igdb',
          raw: {
            multiplayer: {
              maxOnlinePlayers: 12,
              maxPlayers: 12,
            },
          },
        },
      ],
    });

    expect(payload.maxPlayers).toBe(12);
  });

  it('derives maxPlayers from igdbPayload multiplayer modes when no source max exists', () => {
    const payload = buildCollectableResponsePayload({
      id: 11,
      kind: 'game',
      title: 'Halo Infinite',
      igdbPayload: {
        game: {
          multiplayer_modes: [
            { offlinemax: 4, onlinemax: 8 },
            { offlinemax: 2, onlinemax: 16 },
          ],
        },
      },
    });

    expect(payload.maxPlayers).toBe(16);
    expect(payload.igdbPayload).toBeUndefined();
  });

  it('prefers explicit maxPlayers over derived multiplayer metadata', () => {
    const payload = buildCollectableResponsePayload({
      id: 12,
      kind: 'games',
      title: 'Street Fighter',
      maxPlayers: 2,
      sources: [
        {
          provider: 'igdb',
          raw: {
            multiplayer: {
              maxPlayers: 8,
            },
          },
        },
      ],
    });

    expect(payload.maxPlayers).toBe(2);
  });
});
