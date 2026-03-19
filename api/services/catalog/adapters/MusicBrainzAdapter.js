/**
 * MusicBrainzAdapter - Adapter for the MusicBrainz API
 *
 * Wraps the MusicCatalogService methods to implement the standard CatalogAdapter interface.
 * MusicBrainz is a public API — no API key required.
 */

const { makeLightweightFingerprint } = require('../../collectables/fingerprint');
const { musicbrainzReleaseGroupToCollectable } = require('../../../adapters/musicbrainz.adapter');
const { withTimeout } = require('../../../utils/withTimeout');

const DEFAULT_LOOKUP_TIMEOUT_MS = 15000;

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

class MusicBrainzAdapter {
  constructor(options = {}) {
    this.name = 'musicbrainz';
    this._service = null;
    this._serviceOptions = options;
    this.lookupTimeoutMs = Number.isFinite(options.lookupTimeoutMs)
      ? options.lookupTimeoutMs
      : Number.parseInt(process.env.MUSICBRAINZ_LOOKUP_TIMEOUT_MS || '', 10) ||
      DEFAULT_LOOKUP_TIMEOUT_MS;
  }

  /**
   * Lazy-load the MusicCatalogService to avoid circular dependencies.
   */
  _getService() {
    if (!this._service) {
      const { MusicCatalogService } = require('../MusicCatalogService');
      this._service = new MusicCatalogService(this._serviceOptions);
    }
    return this._service;
  }

  /**
   * MusicBrainz is a public API — always configured.
   */
  isConfigured() {
    return true;
  }

  /**
   * Main lookup method.
   * @param {object} item - Item with title, artist/primaryCreator, etc.
   * @param {object} options - Additional options
   * @returns {Promise<object|null>} Collectable-shaped result or null
   */
  async lookup(item, options = {}) {
    const service = this._getService();
    const title = normalizeString(item?.name || item?.title);

    if (!title) {
      return null;
    }

    try {
      const result = await withTimeout(
        () => service.safeLookup(item, options.retries || 2),
        this.lookupTimeoutMs,
        '[MusicBrainzAdapter] lookup',
      );

      if (result && result.releaseGroup) {
        return this._toCollectable(result, item);
      }
    } catch (err) {
      console.warn('[MusicBrainzAdapter] lookup failed:', err.message);
    }

    return null;
  }

  /**
   * Convert MusicBrainz API response to standard collectable format.
   */
  _toCollectable(result, originalItem) {
    const lwf = makeLightweightFingerprint({
      ...originalItem,
      kind: originalItem?.kind || originalItem?.type || 'album',
    });

    const collectable = musicbrainzReleaseGroupToCollectable(result.releaseGroup, {
      lightweightFingerprint: lwf,
      score: result.score,
    });

    if (collectable) {
      collectable.provider = 'musicbrainz';
      collectable._raw = result;

      if (!collectable.lightweightFingerprint) {
        collectable.lightweightFingerprint = lwf;
      }
    }

    return collectable;
  }
}

module.exports = MusicBrainzAdapter;
