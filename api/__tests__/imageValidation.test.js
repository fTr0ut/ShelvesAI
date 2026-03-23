const { validateImageBuffer } = require('../utils/imageValidation');

jest.mock('file-type', () => ({
  fromBuffer: jest.fn(),
}));

jest.mock('image-size', () => jest.fn());

const FileType = require('file-type');
const sizeOf = require('image-size');

describe('validateImageBuffer', () => {
  const buffer = Buffer.from('test-bytes');

  beforeEach(() => {
    jest.clearAllMocks();
    FileType.fromBuffer.mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
  });

  it('rejects oversize dimensions with default cap', async () => {
    sizeOf.mockReturnValue({ width: 5712, height: 4284 });

    await expect(validateImageBuffer(buffer)).rejects.toThrow('Image dimensions exceed 4096x4096');
  });

  it('accepts iPhone-class dimensions for vision-style limits', async () => {
    sizeOf.mockReturnValue({ width: 5712, height: 4284 });

    await expect(
      validateImageBuffer(buffer, { maxDimension: 8192, maxPixels: 40000000 }),
    ).resolves.toEqual(expect.objectContaining({
      mime: 'image/jpeg',
      width: 5712,
      height: 4284,
    }));
  });

  it('rejects images that exceed maxPixels when provided', async () => {
    sizeOf.mockReturnValue({ width: 5712, height: 4284 });

    await expect(
      validateImageBuffer(buffer, { maxDimension: 8192, maxPixels: 10000000 }),
    ).rejects.toThrow('Image area exceeds 10000000 pixels');
  });
});
