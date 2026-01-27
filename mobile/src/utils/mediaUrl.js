/**
 * Media URL resolution utilities
 * Handles resolving media paths to full URLs, preferring pre-resolved URLs from the API
 */

/**
 * Get the profile picture URL from a user/profile object
 * Prefers profileMediaUrl (pre-resolved from API) over constructing from path
 *
 * @param {Object} user - User/profile object
 * @param {string} apiBase - API base URL for fallback path construction
 * @returns {string|null} - Full URL or null
 */
export function getProfileImageUrl(user, apiBase) {
  if (!user) return null;

  // Prefer pre-resolved URL from API (handles S3/CloudFront)
  if (user.profileMediaUrl) {
    return user.profileMediaUrl;
  }

  // Fallback to constructing URL from path (local development)
  if (user.profileMediaPath && apiBase) {
    const trimmed = user.profileMediaPath.replace(/^\/+/, '');
    return `${apiBase}/media/${trimmed}`;
  }

  // Legacy picture field (external URLs like Google OAuth)
  if (user.picture) {
    return user.picture;
  }

  return null;
}

/**
 * Get the cover image URL from a collectable/item object
 * Prefers coverMediaUrl (pre-resolved from API) over constructing from path
 *
 * @param {Object} item - Collectable/item object
 * @param {string} apiBase - API base URL for fallback path construction
 * @returns {string|null} - Full URL or null
 */
export function getCoverImageUrl(item, apiBase) {
  if (!item) return null;

  // Prefer pre-resolved URL from API (handles S3/CloudFront)
  if (item.coverMediaUrl) {
    return item.coverMediaUrl;
  }

  // Fallback to constructing URL from path
  if (item.coverMediaPath && apiBase) {
    const trimmed = item.coverMediaPath.replace(/^\/+/, '');
    return `${apiBase}/media/${trimmed}`;
  }

  // Fallback to external cover URLs
  if (item.coverImageUrl) {
    return item.coverImageUrl;
  }

  if (item.coverUrl) {
    return item.coverUrl;
  }

  return null;
}

/**
 * Get image source object for React Native Image component
 *
 * @param {string|null} url - Image URL
 * @returns {Object|null} - Image source object or null
 */
export function toImageSource(url) {
  if (!url) return null;
  return { uri: url };
}

/**
 * Get profile image source for React Native Image component
 *
 * @param {Object} user - User/profile object
 * @param {string} apiBase - API base URL
 * @returns {Object|null} - Image source object or null
 */
export function getProfileImageSource(user, apiBase) {
  return toImageSource(getProfileImageUrl(user, apiBase));
}

/**
 * Get cover image source for React Native Image component
 *
 * @param {Object} item - Collectable/item object
 * @param {string} apiBase - API base URL
 * @returns {Object|null} - Image source object or null
 */
export function getCoverImageSource(item, apiBase) {
  return toImageSource(getCoverImageUrl(item, apiBase));
}
