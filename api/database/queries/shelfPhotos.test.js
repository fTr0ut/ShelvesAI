'use strict';

const fs = require('fs/promises');
const { query } = require('../pg');
const s3 = require('../../services/s3');
const { validateImageBuffer } = require('../../utils/imageValidation');
const {
  uploadPhotoForShelf,
  clearPhotoForShelf,
  loadPhotoBuffer,
} = require('./shelfPhotos');

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from('local-photo')),
}));

jest.mock('../../services/s3', () => ({
  isEnabled: jest.fn(() => false),
  uploadPrivateBuffer: jest.fn().mockResolvedValue('uploaded'),
  deleteObject: jest.fn().mockResolvedValue(undefined),
  getObjectBuffer: jest.fn().mockResolvedValue({
    buffer: Buffer.from('remote-photo'),
    contentType: 'image/jpeg',
    contentLength: 12,
  }),
}));

jest.mock('../../utils/imageValidation', () => ({
  validateImageBuffer: jest.fn().mockResolvedValue({
    mime: 'image/jpeg',
    width: 640,
    height: 480,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('shelfPhotos.uploadPhotoForShelf', () => {
  it('uploads photo and rotates previous asset when replacing', async () => {
    s3.isEnabled.mockReturnValue(true);
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          owner_id: 'user-1',
          photo_storage_provider: 's3',
          photo_storage_key: 'shelf-photos/user-1/7/old.jpg',
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          owner_id: 'user-1',
          photo_storage_provider: 's3',
          photo_storage_key: 'shelf-photos/user-1/7/new.jpg',
          photo_content_type: 'image/jpeg',
          photo_size_bytes: 5,
          photo_width: 640,
          photo_height: 480,
          photo_updated_at: '2026-04-01T12:00:00.000Z',
        }],
        rowCount: 1,
      });

    const result = await uploadPhotoForShelf({
      shelfId: 7,
      userId: 'user-1',
      buffer: Buffer.from('photo'),
      contentType: 'image/jpeg',
    });

    expect(validateImageBuffer).toHaveBeenCalled();
    expect(s3.uploadPrivateBuffer).toHaveBeenCalled();
    expect(s3.deleteObject).toHaveBeenCalledWith('shelf-photos/user-1/7/old.jpg');
    expect(result).toEqual(expect.objectContaining({
      id: 7,
      photoStorageKey: 'shelf-photos/user-1/7/new.jpg',
      photoStorageProvider: 's3',
    }));
  });
});

describe('shelfPhotos.clearPhotoForShelf', () => {
  it('clears db metadata and attempts to delete old asset', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          photo_storage_provider: 's3',
          photo_storage_key: 'shelf-photos/user-1/7/current.jpg',
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          owner_id: 'user-1',
          photo_storage_provider: null,
          photo_storage_key: null,
          photo_content_type: null,
          photo_size_bytes: null,
          photo_width: null,
          photo_height: null,
          photo_updated_at: null,
        }],
        rowCount: 1,
      });

    const result = await clearPhotoForShelf({ shelfId: 7, userId: 'user-1' });

    expect(query.mock.calls[1][0]).toContain('photo_storage_provider = NULL');
    expect(s3.deleteObject).toHaveBeenCalledWith('shelf-photos/user-1/7/current.jpg');
    expect(result).toEqual(expect.objectContaining({
      id: 7,
      photoStorageKey: null,
    }));
  });
});

describe('shelfPhotos.loadPhotoBuffer', () => {
  it('loads shelf photo bytes from s3', async () => {
    const payload = await loadPhotoBuffer({
      photoStorageProvider: 's3',
      photoStorageKey: 'shelf-photos/user-1/7/current.jpg',
      photoContentType: 'image/jpeg',
    });

    expect(s3.getObjectBuffer).toHaveBeenCalledWith('shelf-photos/user-1/7/current.jpg');
    expect(payload).toEqual(expect.objectContaining({
      contentType: 'image/jpeg',
      contentLength: 12,
    }));
  });

  it('loads shelf photo bytes from local storage', async () => {
    const payload = await loadPhotoBuffer({
      photoStorageProvider: 'local',
      photoStorageKey: 'shelf-photos/user-1/7/current.jpg',
      photoContentType: 'image/jpeg',
    });

    expect(fs.readFile).toHaveBeenCalled();
    expect(payload).toEqual(expect.objectContaining({
      contentType: 'image/jpeg',
      contentLength: Buffer.from('local-photo').length,
    }));
  });
});
