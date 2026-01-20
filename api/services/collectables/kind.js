const KIND_ALIASES = {
  book: 'book',
  books: 'book',
  novel: 'book',
  novels: 'book',
  comic: 'book',
  comics: 'book',
  manga: 'book',
  movie: 'movie',
  movies: 'movie',
  film: 'movie',
  films: 'movie',
  bluray: 'movie',
  blurays: 'movie',
  dvd: 'movie',
  dvds: 'movie',
  tv: 'tv',
  tvshow: 'tv',
  tvshows: 'tv',
  series: 'tv',
  television: 'tv',
  game: 'game',
  games: 'game',
  videogame: 'game',
  videogames: 'game',
  album: 'album',
  albums: 'album',
  vinyl: 'album',
  record: 'album',
  records: 'album',
  music: 'album',
  cd: 'album',
  cds: 'album',
  other: 'other',
  item: 'item',
  items: 'item',
};

function normalizeCollectableKind(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  const compact = normalized.replace(/[^a-z0-9]+/g, '');
  return KIND_ALIASES[normalized] || KIND_ALIASES[compact] || normalized;
}

module.exports = {
  normalizeCollectableKind,
};
