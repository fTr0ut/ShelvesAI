'use strict';

const fs = require('fs/promises');
const { query } = require('../pg');
const s3 = require('../../services/s3');
const { prepareShelfUploadImage } = require('../../services/shelfImageUpload');
const { uploadOwnerPhotoForItem } = require('./userCollectionPhotos');
const { renderOwnerPhotoThumbnail } = require('../../services/ownerPhotoThumbnail');

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from('stored-owner-photo')),
}));

jest.mock('../../services/s3', () => ({
  isEnabled: jest.fn(() => false),
  uploadPrivateBuffer: jest.fn().mockResolvedValue(undefined),
  deleteObject: jest.fn().mockResolvedValue(undefined),
  getObjectBuffer: jest.fn(),
}));

jest.mock('../../services/shelfImageUpload', () => ({
  prepareShelfUploadImage: jest.fn().mockResolvedValue({
    buffer: Buffer.from('processed-owner'),
    mime: 'image/webp',
    width: 2048,
    height: 1536,
    sizeBytes: 15,
  }),
}));

jest.mock('../../services/ownerPhotoThumbnail', () => ({
  renderOwnerPhotoThumbnail: jest.fn().mockResolvedValue({
    buffer: Buffer.from('processed-thumb'),
    contentType: 'image/jpeg',
    width: 300,
    height: 400,
    box: { x: 0, y: 0, width: 1, height: 1 },
  }),
  resolveThumbnailBoxForOwnerPhoto: jest.fn(() => null),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('userCollectionPhotos.uploadOwnerPhotoForItem', () => {
  it('stores the processed owner photo buffer and metadata', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          owner_photo_source: 'upload',
          owner_photo_storage_provider: 'local',
          owner_photo_storage_key: 'owner-photos/1/7/55/old.webp',
          owner_photo_thumb_storage_provider: null,
          owner_photo_thumb_storage_key: null,
          owner_photo_thumb_box: null,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 55,
          user_id: 1,
          shelf_id: 7,
          owner_photo_source: 'upload',
          owner_photo_storage_provider: 'local',
          owner_photo_storage_key: 'owner-photos/1/7/55/new.webp',
          owner_photo_content_type: 'image/webp',
          owner_photo_size_bytes: 15,
          owner_photo_width: 2048,
          owner_photo_height: 1536,
          owner_photo_thumb_storage_provider: null,
          owner_photo_thumb_storage_key: null,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 55,
          owner_photo_source: 'upload',
          owner_photo_content_type: 'image/webp',
          owner_photo_width: 2048,
          owner_photo_height: 1536,
          owner_photo_thumb_content_type: 'image/jpeg',
          owner_photo_thumb_width: 300,
          owner_photo_thumb_height: 400,
        }],
        rowCount: 1,
      });

    const result = await uploadOwnerPhotoForItem({
      itemId: 55,
      userId: 1,
      shelfId: 7,
      buffer: Buffer.from('original-owner'),
      contentType: 'image/jpeg',
    });

    expect(prepareShelfUploadImage).toHaveBeenCalledWith(Buffer.from('original-owner'));
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('/owner-photos/1/7/55/'),
      Buffer.from('processed-owner'),
    );
    expect(renderOwnerPhotoThumbnail).toHaveBeenCalledWith({
      sourceBuffer: Buffer.from('processed-owner'),
      box: null,
    });
    expect(query.mock.calls[1][1]).toEqual(expect.arrayContaining([
      'local',
      expect.stringMatching(/^owner-photos\/1\/7\/55\/.+\.webp$/),
      'image/webp',
      15,
      2048,
      1536,
      55,
      1,
      7,
    ]));
    expect(result).toEqual(expect.objectContaining({
      id: 55,
      ownerPhotoContentType: 'image/webp',
      ownerPhotoWidth: 2048,
      ownerPhotoHeight: 1536,
    }));
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('/owner-photos/1/7/55/old.webp'));
  });
});
