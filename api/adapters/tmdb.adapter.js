const {
  makeCollectableFingerprint,
  makeLightweightFingerprint,
} = require('../services/collectables/fingerprint');

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeCompare(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function extractYear(value) {
  if (!value) return null;
  const match = String(value).match(/\b(\d{4})\b/);
  return match ? match[1] : null;
}

function buildImageVariants(path, options = {}) {
  if (!path) return null;
  const base = normalizeString(options.imageBaseUrl || 'https://image.tmdb.org/t/p').replace(/\/$/, '');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return {
    urlSmall: `${base}/w185${normalized}`,
    urlMedium: `${base}/w342${normalized}`,
    urlLarge: `${base}/w780${normalized}`,
    urlOriginal: `${base}/original${normalized}`,
  };
}

function findPrimaryCertification(releaseDates, preferredRegions = ['US', 'GB', 'CA']) {
  if (!Array.isArray(releaseDates)) return null;
  const rankedRegions = preferredRegions.concat(releaseDates.map((r) => r.iso_3166_1)).filter(Boolean);
  for (const region of rankedRegions) {
    const entry = releaseDates.find((r) => r && r.iso_3166_1 === region);
    if (!entry || !Array.isArray(entry.release_dates)) continue;
    const certification = entry.release_dates.find((rd) => rd && rd.certification);
    if (certification && certification.certification) {
      return {
        region: region,
        certification: certification.certification,
        releaseDate: certification.release_date || null,
      };
    }
  }
  return null;
}

function tmdbMovieToCollectable(movie, options = {}) {
  if (!movie || !movie.id) return null;

  const title = movie.title || movie.name || movie.original_title || null;
  const releaseDate = movie.release_date || null;
  const year = extractYear(releaseDate);

  const crew = Array.isArray(movie.credits?.crew) ? movie.credits.crew : [];
  const directors = crew.filter((member) => normalizeCompare(member?.job) === 'director');
  const directorNames = uniqueStrings(directors.map((member) => member?.name));

  const cast = Array.isArray(movie.credits?.cast) ? movie.credits.cast : [];
  const castNames = uniqueStrings(cast.slice(0, 6).map((member) => member?.name));

  const primaryCreator = directorNames[0] || castNames[0] || null;

  const genres = uniqueStrings((movie.genres || []).map((genre) => genre?.name));

  const keywords = Array.isArray(movie.keywords?.keywords)
    ? movie.keywords.keywords
    : Array.isArray(movie.keywords?.results)
      ? movie.keywords.results
      : [];
  const keywordNames = uniqueStrings(keywords.map((keyword) => keyword?.name));

  const identifiers = {
    tmdb: {
      movie: [String(movie.id)],
    },
  };
  if (movie.imdb_id) {
    identifiers.imdb = [String(movie.imdb_id)];
  }
  if (Array.isArray(movie.production_companies) && movie.production_companies.length) {
    identifiers.productionCompanies = movie.production_companies
      .filter((company) => company?.id != null)
      .map((company) => String(company.id));
  }

  const poster = buildImageVariants(movie.poster_path, options);
  const backdrop = buildImageVariants(movie.backdrop_path, options);

  const images = [];
  if (poster) {
    images.push({
      kind: 'poster',
      urlSmall: poster.urlSmall,
      urlMedium: poster.urlMedium,
      urlLarge: poster.urlLarge,
      provider: 'tmdb',
    });
  }
  if (backdrop) {
    images.push({
      kind: 'backdrop',
      urlSmall: backdrop.urlSmall,
      urlMedium: backdrop.urlMedium,
      urlLarge: backdrop.urlLarge,
      provider: 'tmdb',
    });
  }

  const tmdbBaseUrl = normalizeString(options.baseUrl || 'https://api.themoviedb.org/3').replace(/\/$/, '');
  const tmdbPageUrl = `https://www.themoviedb.org/movie/${movie.id}`;
  const imdbUrl = movie.imdb_id ? `https://www.imdb.com/title/${movie.imdb_id}/` : null;

  const certification = findPrimaryCertification(movie.release_dates?.results || []);

  const fetchedAt = options.fetchedAt || new Date();
  const rawSourcePayload = {};
  if (options.score !== undefined) rawSourcePayload.score = options.score;
  if (movie.popularity !== undefined) rawSourcePayload.popularity = movie.popularity;
  if (movie.vote_average !== undefined) rawSourcePayload.voteAverage = movie.vote_average;
  if (movie.vote_count !== undefined) rawSourcePayload.voteCount = movie.vote_count;

  const tmdbSource = {
    provider: 'tmdb',
    ids: {
      movie: String(movie.id),
      ...(movie.imdb_id ? { imdb: movie.imdb_id } : {}),
    },
    urls: {
      movie: tmdbPageUrl,
      api: `${tmdbBaseUrl}/movie/${movie.id}`,
      ...(imdbUrl ? { imdb: imdbUrl } : {}),
    },
    fetchedAt,
  };
  if (Object.keys(rawSourcePayload).length) {
    tmdbSource.raw = rawSourcePayload;
  }
  const sources = [tmdbSource];

  const productionCompanies = Array.isArray(movie.production_companies)
    ? movie.production_companies.map((company) => company?.name).filter(Boolean)
    : [];
  const productionCountries = Array.isArray(movie.production_countries)
    ? movie.production_countries.map((country) => country?.name).filter(Boolean)
    : [];
  const spokenLanguages = Array.isArray(movie.spoken_languages)
    ? movie.spoken_languages.map((lang) => lang?.name || lang?.english_name).filter(Boolean)
    : [];

  const extras = {
    runtime: movie.runtime ?? null,
    status: movie.status || null,
    tagline: movie.tagline || null,
    releaseDate,
    certification,
    originalTitle: movie.original_title || null,
    originalLanguage: movie.original_language || null,
    productionCompanies,
    productionCountries,
    spokenLanguages,
    budget: movie.budget ?? null,
    revenue: movie.revenue ?? null,
    homepage: movie.homepage || null,
    posterOriginalUrl: poster ? poster.urlOriginal : null,
    backdropOriginalUrl: backdrop ? backdrop.urlOriginal : null,
  };

  const physical = {};
  const normalizedFormat = normalizeString(options.format);
  if (normalizedFormat) {
    physical.format = normalizedFormat;
  }
  if (Object.keys(physical).length) {
    physical.extras = physical.extras || {};
  }

  const lightweightFingerprint = options.lightweightFingerprint
    ? options.lightweightFingerprint
    : makeLightweightFingerprint({ title, primaryCreator, kind: 'movie' });

  const fingerprint = makeCollectableFingerprint({
    title,
    primaryCreator,
    releaseYear: year,
    mediaType: 'movie',
  });

  return {
    kind: 'movie',
    type: 'movie',
    title: title || '',
    description: movie.overview || null,
    primaryCreator,
    creators: uniqueStrings([...directorNames, ...castNames]),
    year: year || null,
    publisher: productionCompanies[0] || null,
    tags: keywordNames,
    genre: genres,
    lightweightFingerprint: lightweightFingerprint || null,
    fingerprint: fingerprint || null,
    identifiers,
    images,
    sources,
    extras,
    physical: Object.keys(physical).length ? physical : undefined,

    // Provider-agnostic cover fields (TMDB allows caching, null means 'needs resolution')
    coverImageUrl: poster?.urlLarge || poster?.urlMedium || null,
    coverImageSource: null,

    // Provider-agnostic attribution (TMDB requires logo + disclaimer)
    attribution: {
      linkUrl: `https://www.themoviedb.org/movie/${movie.id}`,
      linkText: 'View on TMDB',
      logoKey: 'tmdb',
      disclaimerText: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    },
  };
}

module.exports = {
  tmdbMovieToCollectable,
};
