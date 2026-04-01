class CatalogProvidersUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message || 'Catalog providers are temporarily unavailable. Please try again later.');
    this.name = 'CatalogProvidersUnavailableError';
    this.code = 'CATALOG_PROVIDERS_UNAVAILABLE';
    this.details = details;
  }
}

module.exports = {
  CatalogProvidersUnavailableError,
};
