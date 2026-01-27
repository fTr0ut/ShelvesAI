/**
 * Media URL Resolver
 * Resolves local media paths to full URLs based on environment configuration.
 *
 * When S3 is enabled (production): Returns CloudFront/S3 URLs
 * When S3 is disabled (local dev): Returns relative paths for /media route
 */

const s3 = require('./s3');

/**
 * Resolve a local media path to a full URL.
 *
 * @param {string|null} localPath - The local path (e.g., "profiles/user123/abc.jpg")
 * @returns {string|null} - Full URL or null if no path provided
 *
 * @example
 * // S3 enabled with CloudFront:
 * resolveMediaUrl('profiles/user123/abc.jpg')
 * // => 'https://d6q7znjmixmww.cloudfront.net/profiles/user123/abc.jpg'
 *
 * // S3 disabled (local):
 * resolveMediaUrl('profiles/user123/abc.jpg')
 * // => '/media/profiles/user123/abc.jpg'
 */
function resolveMediaUrl(localPath) {
  if (!localPath) {
    return null;
  }

  // Normalize path: remove leading slashes and backslashes
  const normalizedPath = localPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');

  if (s3.isEnabled()) {
    // S3 is configured - return full S3/CloudFront URL
    const publicUrl = process.env.S3_PUBLIC_URL;
    const bucket = process.env.S3_BUCKET_NAME;
    const region = process.env.AWS_REGION || 'us-east-1';

    if (publicUrl) {
      // Ensure protocol is included
      let baseUrl = publicUrl.trim();
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        baseUrl = `https://${baseUrl}`;
      }
      // Remove trailing slash
      baseUrl = baseUrl.replace(/\/+$/, '');
      return `${baseUrl}/${normalizedPath}`;
    }

    if (bucket) {
      // Fall back to standard S3 URL
      return `https://${bucket}.s3.${region}.amazonaws.com/${normalizedPath}`;
    }
  }

  // S3 not configured - return relative path for local /media route
  // The client will prepend their apiBase URL
  return `/media/${normalizedPath}`;
}

/**
 * Add resolved media URLs to an object containing media path fields.
 * Transforms fields like 'profileMediaPath' to 'profileMediaUrl'.
 *
 * @param {Object} obj - Object with potential media path fields
 * @param {string[]} pathFields - Field names to resolve (default: common media path fields)
 * @returns {Object} - Object with additional URL fields
 *
 * @example
 * addMediaUrls({ profileMediaPath: 'profiles/user123/abc.jpg', name: 'John' })
 * // => { profileMediaPath: 'profiles/user123/abc.jpg', profileMediaUrl: 'https://...', name: 'John' }
 */
function addMediaUrls(obj, pathFields = ['profileMediaPath', 'coverMediaPath', 'collectableCoverMediaPath']) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const result = { ...obj };

  for (const pathField of pathFields) {
    if (Object.prototype.hasOwnProperty.call(obj, pathField)) {
      // Convert 'profileMediaPath' to 'profileMediaUrl'
      const urlField = pathField.replace(/Path$/, 'Url');
      result[urlField] = resolveMediaUrl(obj[pathField]);
    }
  }

  return result;
}

/**
 * Check if S3 storage is being used for media
 * @returns {boolean}
 */
function isUsingS3() {
  return s3.isEnabled();
}

module.exports = {
  resolveMediaUrl,
  addMediaUrls,
  isUsingS3,
};
