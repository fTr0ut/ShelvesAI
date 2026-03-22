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
});
