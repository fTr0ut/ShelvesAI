const multer = require('multer');

function imageUploadErrorHandler(err, _req, res, next) {
  if (!err) return next();

  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'Image too large. Please try taking another photo or use a lower quality setting.',
      code: 'image_too_large',
    });
  }

  if (err?.status === 400 || err?.statusCode === 400 || err?.code === 'invalid_image_type') {
    return res.status(400).json({
      error: err.message || 'Only JPEG, PNG, and WEBP images are allowed',
      code: err.code || 'invalid_image_type',
    });
  }

  return next(err);
}

module.exports = {
  imageUploadErrorHandler,
};
