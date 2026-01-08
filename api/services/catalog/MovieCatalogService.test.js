const { MovieCatalogService } = require('./MovieCatalogService');

function buildSampleMovie(overrides = {}) {
  return {
    id: 123,
    title: 'Inception',
    original_title: 'Inception',
    release_date: '2010-07-16',
    overview: 'A thief who steals corporate secrets...',
    imdb_id: 'tt1375666',
    runtime: 148,
    status: 'Released',
    tagline: 'Your mind is the scene of the crime.',
    original_language: 'en',
    popularity: 100,
    vote_average: 8.3,
    vote_count: 34000,
    poster_path: '/poster.jpg',
    backdrop_path: '/backdrop.jpg',
    production_companies: [
      { id: 9993, name: 'Legendary Pictures' },
      { id: 9994, name: 'Syncopy' },
    ],
    production_countries: [{ iso_3166_1: 'US', name: 'United States of America' }],
    spoken_languages: [
      { iso_639_1: 'en', name: 'English', english_name: 'English' },
      { iso_639_1: 'ja', name: '日本語', english_name: 'Japanese' },
    ],
    genres: [
      { id: 28, name: 'Action' },
      { id: 878, name: 'Science Fiction' },
    ],
    keywords: {
      keywords: [
        { id: 1, name: 'dream' },
        { id: 2, name: 'subconscious' },
      ],
    },
    credits: {
      cast: [
        { name: 'Leonardo DiCaprio' },
        { name: 'Joseph Gordon-Levitt' },
      ],
      crew: [
        { job: 'Director', name: 'Christopher Nolan' },
        { job: 'Producer', name: 'Emma Thomas' },
      ],
    },
    release_dates: {
      results: [
        {
          iso_3166_1: 'US',
          release_dates: [
            { certification: 'PG-13', release_date: '2010-07-16T00:00:00.000Z' },
          ],
        },
      ],
    },
    homepage: 'https://www.warnerbros.com/movies/inception',
    budget: 160000000,
    revenue: 825532764,
    ...overrides,
  };
}

describe('MovieCatalogService', () => {
  it('supports movie-focused shelf types', () => {
    const service = new MovieCatalogService({ apiKey: 'fake' });
    expect(service.supportsShelfType('Movies')).toBe(true);
    expect(service.supportsShelfType('Film Shelf')).toBe(true);
    expect(service.supportsShelfType('Blu-Ray Collection')).toBe(true);
    expect(service.supportsShelfType('Board Games')).toBe(false);
  });

  it('maps TMDB payloads to Collectable documents', () => {
    const service = new MovieCatalogService({ apiKey: 'fake' });
    const sampleMovie = buildSampleMovie();
    const entry = {
      status: 'resolved',
      enrichment: {
        provider: 'tmdb',
        movie: sampleMovie,
        score: 123.45,
      },
    };
    const item = { format: 'Blu-ray' };
    const lightweightFingerprint = 'lwf-value';

    const collectable = service.buildCollectablePayload(entry, item, lightweightFingerprint);

    expect(collectable.kind).toBe('movie');
    expect(collectable.type).toBe('movie');
    expect(collectable.title).toBe('Inception');
    expect(collectable.primaryCreator).toBe('Christopher Nolan');
    expect(collectable.publisher).toBe('Legendary Pictures');
    expect(collectable.genre).toEqual(['Action', 'Science Fiction']);
    expect(collectable.tags).toEqual(['dream', 'subconscious']);
    expect(collectable.identifiers.tmdb.movie).toEqual(['123']);
    expect(collectable.identifiers.imdb).toEqual(['tt1375666']);
    expect(collectable.sources[0].provider).toBe('tmdb');
    expect(collectable.sources[0].ids.movie).toBe('123');
    expect(collectable.images.length).toBe(2);
    expect(collectable.extras.posterOriginalUrl).toContain('/poster.jpg');
    expect(collectable.physical.format).toBe('Blu-ray');
    expect(collectable.lightweightFingerprint).toBe(lightweightFingerprint);
    expect(collectable.fingerprint).toBeTruthy();
  });
});
