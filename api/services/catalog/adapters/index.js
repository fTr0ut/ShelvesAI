/**
 * Catalog Adapters Index
 * 
 * Exports all available catalog adapters for use by CatalogRouter.
 */

const HardcoverAdapter = require('./HardcoverAdapter');
const OpenLibraryAdapter = require('./OpenLibraryAdapter');
const IgdbAdapter = require('./IgdbAdapter');
const TmdbAdapter = require('./TmdbAdapter');
const TmdbTvAdapter = require('./TmdbTvAdapter');

module.exports = {
    HardcoverAdapter,
    OpenLibraryAdapter,
    IgdbAdapter,
    TmdbAdapter,
    TmdbTvAdapter,
};
