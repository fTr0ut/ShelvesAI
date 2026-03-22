jest.mock('../database/queries/media', () => ({
  ensureCoverMediaForCollectable: jest.fn(),
}));

jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const pg = require('../database/pg');
const { ensureCoverMediaForCollectable } = require('../database/queries/media');
const { runBackfill } = require('../scripts/backfill-missing-cover-media');

describe('backfill-missing-cover-media script', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('scans local-source candidates and reports success/skip/fail counts', async () => {
    pg.query.mockResolvedValueOnce({
      rows: [
        { id: 1, kind: 'books', title: 'A', images: [], cover_url: 'https://img/a.jpg', cover_image_url: null },
        { id: 2, kind: 'books', title: 'B', images: [], cover_url: null, cover_image_url: 'https://img/b.jpg' },
        { id: 3, kind: 'movies', title: 'C', images: [{ url: 'https://img/c.jpg' }], cover_url: null, cover_image_url: null },
      ],
    });

    ensureCoverMediaForCollectable
      .mockResolvedValueOnce({ id: 1001 })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('network timeout'));

    const summary = await runBackfill({ limit: 3, delayMs: 0 });

    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining('cover_media_id IS NULL'),
      [3],
    );
    expect(ensureCoverMediaForCollectable).toHaveBeenCalledTimes(3);
    expect(ensureCoverMediaForCollectable).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ collectableId: 1, coverImageSource: 'local' }),
    );
    expect(ensureCoverMediaForCollectable).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ collectableId: 2, coverImageSource: 'local' }),
    );
    expect(summary).toEqual({
      scanned: 3,
      succeeded: 1,
      skipped: 1,
      failed: 1,
    });
  });
});
