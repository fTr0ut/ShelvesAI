/**
 * Discovery Service Adapters
 *
 * These adapters fetch trending, upcoming, and recent content from catalog APIs
 * for the personalized news/discover feed.
 */

const TmdbDiscoveryAdapter = require('./TmdbDiscoveryAdapter');
const IgdbDiscoveryAdapter = require('./IgdbDiscoveryAdapter');

module.exports = {
  TmdbDiscoveryAdapter,
  IgdbDiscoveryAdapter
};
