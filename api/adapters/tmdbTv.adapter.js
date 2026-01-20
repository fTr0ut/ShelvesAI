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

function findPrimaryContentRating(contentRatings, preferredRegions = ['US', 'GB', 'CA']) {
    if (!contentRatings?.results || !Array.isArray(contentRatings.results)) return null;
    const results = contentRatings.results;
    const rankedRegions = preferredRegions.concat(results.map((r) => r.iso_3166_1)).filter(Boolean);
    for (const region of rankedRegions) {
        const entry = results.find((r) => r && r.iso_3166_1 === region);
        if (entry && entry.rating) {
            return {
                region: region,
                certification: entry.rating,
            };
        }
    }
    return null;
}

function tmdbTvToCollectable(tvShow, options = {}) {
    if (!tvShow || !tvShow.id) return null;

    const title = tvShow.name || tvShow.original_name || null;
    const firstAirDate = tvShow.first_air_date || null;
    const year = extractYear(firstAirDate);

    // Creators (showrunners)
    const creators = Array.isArray(tvShow.created_by) ? tvShow.created_by : [];
    const creatorNames = uniqueStrings(creators.map((c) => c?.name));

    // Cast from credits
    const cast = Array.isArray(tvShow.credits?.cast) ? tvShow.credits.cast : [];
    const castNames = uniqueStrings(cast.slice(0, 6).map((member) => member?.name));

    const primaryCreator = creatorNames[0] || castNames[0] || null;

    const genres = uniqueStrings((tvShow.genres || []).map((genre) => genre?.name));

    const keywords = Array.isArray(tvShow.keywords?.results)
        ? tvShow.keywords.results
        : [];
    const keywordNames = uniqueStrings(keywords.map((keyword) => keyword?.name));

    const identifiers = {
        tmdb: {
            tv: [String(tvShow.id)],
        },
    };

    // Networks as production companies equivalent
    if (Array.isArray(tvShow.networks) && tvShow.networks.length) {
        identifiers.networks = tvShow.networks
            .filter((network) => network?.id != null)
            .map((network) => String(network.id));
    }

    const poster = buildImageVariants(tvShow.poster_path, options);
    const backdrop = buildImageVariants(tvShow.backdrop_path, options);

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
    const tmdbPageUrl = `https://www.themoviedb.org/tv/${tvShow.id}`;

    const contentRating = findPrimaryContentRating(tvShow.content_ratings);

    const fetchedAt = options.fetchedAt || new Date();
    const rawSourcePayload = {};
    if (options.score !== undefined) rawSourcePayload.score = options.score;
    if (tvShow.popularity !== undefined) rawSourcePayload.popularity = tvShow.popularity;
    if (tvShow.vote_average !== undefined) rawSourcePayload.voteAverage = tvShow.vote_average;
    if (tvShow.vote_count !== undefined) rawSourcePayload.voteCount = tvShow.vote_count;

    const tmdbSource = {
        provider: 'tmdb',
        ids: {
            tv: String(tvShow.id),
        },
        urls: {
            tv: tmdbPageUrl,
            api: `${tmdbBaseUrl}/tv/${tvShow.id}`,
        },
        fetchedAt,
    };
    if (Object.keys(rawSourcePayload).length) {
        tmdbSource.raw = rawSourcePayload;
    }
    const sources = [tmdbSource];

    const networks = Array.isArray(tvShow.networks)
        ? tvShow.networks.map((network) => network?.name).filter(Boolean)
        : [];
    const productionCompanies = Array.isArray(tvShow.production_companies)
        ? tvShow.production_companies.map((company) => company?.name).filter(Boolean)
        : [];
    const productionCountries = Array.isArray(tvShow.production_countries)
        ? tvShow.production_countries.map((country) => country?.name).filter(Boolean)
        : [];
    const spokenLanguages = Array.isArray(tvShow.spoken_languages)
        ? tvShow.spoken_languages.map((lang) => lang?.name || lang?.english_name).filter(Boolean)
        : [];

    // Episode runtime - take the first value if array
    const episodeRuntime = Array.isArray(tvShow.episode_run_time) && tvShow.episode_run_time.length
        ? tvShow.episode_run_time[0]
        : null;

    const extras = {
        runtime: episodeRuntime,
        status: tvShow.status || null,
        tagline: tvShow.tagline || null,
        firstAirDate,
        lastAirDate: tvShow.last_air_date || null,
        contentRating,
        originalTitle: tvShow.original_name || null,
        originalLanguage: tvShow.original_language || null,
        numberOfSeasons: tvShow.number_of_seasons ?? null,
        numberOfEpisodes: tvShow.number_of_episodes ?? null,
        networks,
        productionCompanies,
        productionCountries,
        spokenLanguages,
        homepage: tvShow.homepage || null,
        posterOriginalUrl: poster ? poster.urlOriginal : null,
        backdropOriginalUrl: backdrop ? backdrop.urlOriginal : null,
        inProduction: tvShow.in_production ?? null,
        type: tvShow.type || null, // e.g., "Scripted", "Reality"
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
        : makeLightweightFingerprint({ title, primaryCreator, kind: 'tv' });

    const fingerprint = makeCollectableFingerprint({
        title,
        primaryCreator,
        releaseYear: year,
        mediaType: 'tv',
    });

    return {
        kind: 'tv',
        type: 'tv',
        title: title || '',
        description: tvShow.overview || null,
        primaryCreator,
        creators: uniqueStrings([...creatorNames, ...castNames]),
        year: year || null,
        runtime: episodeRuntime,
        publisher: networks[0] || productionCompanies[0] || null,
        tags: keywordNames,
        genre: genres,
        lightweightFingerprint: lightweightFingerprint || null,
        fingerprint: fingerprint || null,
        identifiers,
        images,
        sources,
        extras,
        physical: Object.keys(physical).length ? physical : undefined,

        // Provider-agnostic cover fields
        coverImageUrl: poster?.urlLarge || poster?.urlMedium || null,
        coverImageSource: 'external',

        // Provider-agnostic attribution (TMDB requires logo + disclaimer)
        attribution: {
            linkUrl: `https://www.themoviedb.org/tv/${tvShow.id}`,
            linkText: 'View on TMDB',
            logoKey: 'tmdb',
            disclaimerText: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
        },
    };
}

module.exports = {
    tmdbTvToCollectable,
};
