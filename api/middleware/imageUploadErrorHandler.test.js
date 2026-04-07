const multer = require('multer');
const { imageUploadErrorHandler } = require('./imageUploadErrorHandler');

function createRes() {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
  };
  return res;
}

describe('imageUploadErrorHandler', () => {
  it('returns 413 for multer file size errors', () => {
    const err = new multer.MulterError('LIMIT_FILE_SIZE');
    const res = createRes();
    const next = jest.fn();

    imageUploadErrorHandler(err, {}, res, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Image too large. Please try taking another photo or use a lower quality setting.',
      code: 'image_too_large',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 for tagged invalid image type errors', () => {
    const err = new Error('Only JPEG, PNG, and WEBP images are allowed');
    err.status = 400;
    err.code = 'invalid_image_type';
    const res = createRes();
    const next = jest.fn();

    imageUploadErrorHandler(err, {}, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Only JPEG, PNG, and WEBP images are allowed',
      code: 'invalid_image_type',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes unrelated errors to next', () => {
    const err = new Error('boom');
    const res = createRes();
    const next = jest.fn();

    imageUploadErrorHandler(err, {}, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});
