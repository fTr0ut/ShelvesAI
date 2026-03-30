const { BookCatalogService } = require('./BookCatalogService');
const { GameCatalogService } = require('./GameCatalogService');
const { MovieCatalogService } = require('./MovieCatalogService');
const { MusicCatalogService } = require('./MusicCatalogService');
const { TvCatalogService } = require('./TvCatalogService');

const sharedCatalogServices = {
  book: new BookCatalogService(),
  game: new GameCatalogService(),
  movie: new MovieCatalogService(),
  music: new MusicCatalogService(),
  tv: new TvCatalogService(),
};

function getSharedCatalogServices() {
  return sharedCatalogServices;
}

module.exports = {
  getSharedCatalogServices,
};
