'use strict';

const fs = require('fs/promises');
const { query } = require('../pg');
const s3 = require('../../services/s3');
const { prepareShelfUploadImage } = require('../../services/shelfImageUpload');
const { uploadFromBuffer } = require('./manualMedia');

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/s3', () => ({
  isEnabled: jest.fn(() => false),
  uploadBuffer: jest.fn().mockResolvedValue(undefined),
  deleteObject: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/shelfImageUpload', () => ({
  prepareShelfUploadImage: jest.fn().mockResolvedValue({
    buffer: Buffer.from('processed-manual'),
    mime: 'image/png',
    width: 1024,
    height: 768,
    sizeBytes: 16,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('manualMedia.uploadFromBuffer', () => {
  it('stores the processed upload buffer and content type', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ cover_media_path: 'manuals/1/9/old.png' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 9,
          cover_media_path: 'manuals/1/9/new.png',
          cover_content_type: 'image/png',
        }],
        rowCount: 1,
      });

    const result = await uploadFromBuffer({
      userId: 1,
      manualId: 9,
      buffer: Buffer.from('original-manual'),
      contentType: 'image/jpeg',
    });

    expect(prepareShelfUploadImage).toHaveBeenCalledWith(Buffer.from('original-manual'));
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('/manuals/1/9/'),
      Buffer.from('processed-manual'),
    );
    expect(query.mock.calls[1][1]).toEqual([
      expect.stringMatching(/^manuals\/1\/9\/.+\.png$/),
      'image/png',
      9,
    ]);
    expect(result).toEqual(expect.objectContaining({
      id: 9,
      coverContentType: 'image/png',
    }));
  });
});
