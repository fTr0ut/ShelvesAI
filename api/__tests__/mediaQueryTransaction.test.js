jest.mock('node-fetch', () => jest.fn());

jest.mock('../services/s3', () => ({
  isEnabled: jest.fn(),
  uploadBuffer: jest.fn(),
}));

jest.mock('../utils/imageValidation', () => ({
  validateImageBuffer: jest.fn(),
  isAllowedImageMimeType: jest.fn(() => true),
  normalizeMimeType: jest.fn((value) => value),
}));

jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const fetch = require('node-fetch');
const pg = require('../database/pg');
const s3 = require('../services/s3');
const { validateImageBuffer } = require('../utils/imageValidation');
const { ensureCoverMediaForCollectable } = require('../database/queries/media');

describe('ensureCoverMediaForCollectable transaction-aware queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses provided client for select/insert/update without falling back to pool query', async () => {
    const txClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 321, local_path: 'books/tx/cover.jpg' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    s3.isEnabled.mockReturnValue(true);
    s3.uploadBuffer.mockResolvedValue(undefined);
    validateImageBuffer.mockResolvedValue({
      mime: 'image/jpeg',
      width: 100,
      height: 150,
    });
    fetch.mockResolvedValue({
      ok: true,
      url: 'https://img.example.com/cover.jpg',
      headers: {
        get: (key) => {
          if (key === 'content-type') return 'image/jpeg';
          return null;
        },
      },
      buffer: async () => Buffer.from('abc'),
    });

    const result = await ensureCoverMediaForCollectable(
      {
        collectableId: 50,
        images: [],
        coverUrl: 'https://img.example.com/cover.jpg',
        kind: 'books',
        title: 'Transaction Cover',
        coverImageSource: 'local',
      },
      txClient,
    );

    expect(result).toEqual({ id: 321, localPath: 'books/tx/cover.jpg' });
    expect(txClient.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, local_path FROM media WHERE collectable_id = $1'),
      [50, 'https://img.example.com/cover.jpg'],
    );
    expect(txClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO media'),
      expect.any(Array),
    );
    expect(txClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE collectables'),
      [321, 'books/tx/cover.jpg', 50],
    );
    expect(pg.query).not.toHaveBeenCalled();
  });
});
