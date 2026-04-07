jest.mock('../database/queries/media', () => ({
  ensureCoverMediaForCollectable: jest.fn(),
}));

jest.mock('../database/queries/jobRuns', () => ({
  appendJobEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../context', () => ({
  getJobId: jest.fn(() => 'no-job'),
  getUserId: jest.fn(() => null),
}));

jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const pg = require('../database/pg');
const logger = require('../logger');
const collectablesQueries = require('../database/queries/collectables');
const { ensureCoverMediaForCollectable } = require('../database/queries/media');

function buildCollectableRow(overrides = {}) {
  return {
    id: 101,
    fingerprint: 'fp-test',
    lightweight_fingerprint: 'lwf-test',
    kind: 'books',
    title: 'Test Title',
    cover_media_id: null,
    created_at: '2026-03-22T00:00:00.000Z',
    updated_at: '2026-03-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('collectables.upsert media sync transaction behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes tx client to media sync and uses tx client for media path lookup', async () => {
    const txClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [buildCollectableRow({ id: 11, cover_media_id: 55 })] })
        .mockResolvedValueOnce({ rows: [{ local_path: 'books/test/cover.jpg' }] }),
    };

    ensureCoverMediaForCollectable.mockResolvedValueOnce({ id: 55 });

    const result = await collectablesQueries.upsert(
      {
        fingerprint: 'fp-11',
        lightweightFingerprint: 'lwf-11',
        kind: 'books',
        title: 'TX Book',
        coverUrl: 'https://img.example/tx-book.jpg',
        coverImageSource: 'local',
      },
      txClient,
    );

    expect(ensureCoverMediaForCollectable).toHaveBeenCalledWith(
      expect.objectContaining({
        collectableId: 11,
        title: 'TX Book',
        coverImageSource: 'local',
      }),
      txClient,
    );
    expect(txClient.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT local_path FROM media WHERE id = $1'),
      [55],
    );

    const poolSelectCall = pg.query.mock.calls.find(
      (call) => String(call[0] || '').includes('SELECT local_path FROM media WHERE id = $1'),
    );
    expect(poolSelectCall).toBeUndefined();
    expect(result.coverMediaPath).toBe('books/test/cover.jpg');
  });

  it('binds identifiers/market value/market value sources in the correct SQL parameter slots', async () => {
    const txClient = {
      query: jest.fn().mockResolvedValueOnce({ rows: [buildCollectableRow({ id: 31, title: 'Param Book' })] }),
    };
    ensureCoverMediaForCollectable.mockResolvedValueOnce(null);

    await collectablesQueries.upsert(
      {
        fingerprint: 'fp-31',
        lightweightFingerprint: 'lwf-31',
        kind: 'books',
        title: 'Param Book',
        identifiers: { upc: '123456789012' },
        marketValue: 'USD $35',
        marketValueSources: [{ url: 'https://example.com', label: 'Example' }],
      },
      txClient,
    );

    const params = txClient.query.mock.calls[0][1];
    expect(params[15]).toBe(JSON.stringify({ upc: '123456789012' })); // $16 identifiers
    expect(params[16]).toBe('USD $35'); // $17 market_value
    expect(params[17]).toBe(JSON.stringify([{ url: 'https://example.com', label: 'Example' }])); // $18 market_value_sources
  });

  it('remains non-blocking when media sync throws', async () => {
    const txClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [buildCollectableRow({ id: 22, title: 'No Crash Book' })] }),
    };
    ensureCoverMediaForCollectable.mockRejectedValueOnce(new Error('sync failed'));

    await expect(
      collectablesQueries.upsert(
        {
          fingerprint: 'fp-22',
          lightweightFingerprint: 'lwf-22',
          kind: 'books',
          title: 'No Crash Book',
          coverUrl: 'https://img.example/no-crash.jpg',
          coverImageSource: 'local',
        },
        txClient,
      ),
    ).resolves.toEqual(expect.objectContaining({ id: 22, title: 'No Crash Book' }));

    expect(logger.warn).toHaveBeenCalledWith(
      '[collectables.upsert] media sync failed',
      expect.objectContaining({
        collectableId: 22,
        title: 'No Crash Book',
        error: 'sync failed',
      }),
    );
  });

  it('serializes cast_members payload and marks cast update as provided', async () => {
    const txClient = {
      query: jest.fn().mockResolvedValueOnce({ rows: [buildCollectableRow({ id: 41, title: 'Cast Book' })] }),
    };
    ensureCoverMediaForCollectable.mockResolvedValueOnce(null);

    await collectablesQueries.upsert(
      {
        fingerprint: 'fp-41',
        lightweightFingerprint: 'lwf-41',
        kind: 'movies',
        title: 'Cast Book',
        castMembers: [
          { id: 88, name: 'Actor Name', character: 'Lead', order: 0, profile_path: '/actor.jpg' },
        ],
      },
      txClient,
    );

    const params = txClient.query.mock.calls[0][1];
    expect(params[28]).toBe(JSON.stringify([
      {
        personId: 88,
        name: 'Actor Name',
        nameNormalized: 'actor name',
        character: 'Lead',
        order: 0,
        profilePath: '/actor.jpg',
      },
    ]));
    expect(params[29]).toBeNull();
    expect(params[30]).toBeNull();
    expect(params[31]).toBe(true);
    expect(params[32]).toBe(false);
    expect(params[33]).toBe(false);
  });

  it('does not force cast_members overwrite when cast payload is omitted', async () => {
    const txClient = {
      query: jest.fn().mockResolvedValueOnce({ rows: [buildCollectableRow({ id: 42, title: 'No Cast Update' })] }),
    };
    ensureCoverMediaForCollectable.mockResolvedValueOnce(null);

    await collectablesQueries.upsert(
      {
        fingerprint: 'fp-42',
        lightweightFingerprint: 'lwf-42',
        kind: 'movies',
        title: 'No Cast Update',
      },
      txClient,
    );

    const params = txClient.query.mock.calls[0][1];
    expect(params[28]).toBeNull();
    expect(params[30]).toBeNull();
    expect(params[31]).toBe(false);
    expect(params[32]).toBe(false);
    expect(params[33]).toBe(false);
  });

  it('serializes platform_data payload and marks platform overwrite as provided', async () => {
    const txClient = {
      query: jest.fn().mockResolvedValueOnce({ rows: [buildCollectableRow({ id: 43, title: 'Platform Data' })] }),
    };
    ensureCoverMediaForCollectable.mockResolvedValueOnce(null);

    await collectablesQueries.upsert(
      {
        fingerprint: 'fp-43',
        lightweightFingerprint: 'lwf-43',
        kind: 'games',
        title: 'Platform Data',
        platformData: [
          { provider: 'igdb', igdbPlatformId: 169, name: 'Xbox Series X|S', abbreviation: 'XSX' },
        ],
      },
      txClient,
    );

    const params = txClient.query.mock.calls[0][1];
    expect(params[29]).toBe(JSON.stringify([
      {
        provider: 'igdb',
        igdbPlatformId: 169,
        name: 'Xbox Series X|S',
        abbreviation: 'XSX',
        sourceType: null,
        releaseDate: null,
        releaseDateHuman: null,
        releaseRegion: null,
        releaseRegionName: null,
      },
    ]));
    expect(params[30]).toBeNull();
    expect(params[31]).toBe(false);
    expect(params[32]).toBe(true);
    expect(params[33]).toBe(false);
  });

  it('does not force platform_data overwrite when platform payload is omitted', async () => {
    const txClient = {
      query: jest.fn().mockResolvedValueOnce({ rows: [buildCollectableRow({ id: 44, title: 'No Platform Update' })] }),
    };
    ensureCoverMediaForCollectable.mockResolvedValueOnce(null);

    await collectablesQueries.upsert(
      {
        fingerprint: 'fp-44',
        lightweightFingerprint: 'lwf-44',
        kind: 'games',
        title: 'No Platform Update',
      },
      txClient,
    );

    const sql = txClient.query.mock.calls[0][0];
    const params = txClient.query.mock.calls[0][1];
    expect(sql).toContain("COALESCE($30::jsonb, '[]'::jsonb)");
    expect(params[29]).toBeNull();
    expect(params[30]).toBeNull();
    expect(params[32]).toBe(false);
    expect(params[33]).toBe(false);
  });

  it('serializes igdb_payload and marks igdb overwrite as provided', async () => {
    const txClient = {
      query: jest.fn().mockResolvedValueOnce({ rows: [buildCollectableRow({ id: 45, title: 'IGDB Payload' })] }),
    };
    ensureCoverMediaForCollectable.mockResolvedValueOnce(null);

    await collectablesQueries.upsert(
      {
        fingerprint: 'fp-45',
        lightweightFingerprint: 'lwf-45',
        kind: 'games',
        title: 'IGDB Payload',
        igdbPayload: {
          fetchedAt: '2026-03-31T00:00:00.000Z',
          score: 321,
          game: { id: 99, name: 'Halo Infinite' },
        },
      },
      txClient,
    );

    const params = txClient.query.mock.calls[0][1];
    expect(params[30]).toBe(JSON.stringify({
      fetchedAt: '2026-03-31T00:00:00.000Z',
      score: 321,
      game: { id: 99, name: 'Halo Infinite' },
    }));
    expect(params[31]).toBe(false);
    expect(params[32]).toBe(false);
    expect(params[33]).toBe(true);
  });

  it('binds max_players when maxPlayers is provided', async () => {
    const txClient = {
      query: jest.fn().mockResolvedValueOnce({ rows: [buildCollectableRow({ id: 46, title: 'Max Players' })] }),
    };
    ensureCoverMediaForCollectable.mockResolvedValueOnce(null);

    await collectablesQueries.upsert(
      {
        fingerprint: 'fp-46',
        lightweightFingerprint: 'lwf-46',
        kind: 'games',
        title: 'Max Players',
        maxPlayers: 4,
      },
      txClient,
    );

    const params = txClient.query.mock.calls[0][1];
    expect(params[27]).toBe(4);
  });
});
