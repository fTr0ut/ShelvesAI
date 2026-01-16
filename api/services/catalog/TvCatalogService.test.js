const { TvCatalogService } = require('./TvCatalogService');

function buildSampleTvShow(overrides = {}) {
    return {
        id: 1396,
        name: 'Breaking Bad',
        original_name: 'Breaking Bad',
        first_air_date: '2008-01-20',
        last_air_date: '2013-09-29',
        overview: 'When Walter White, a New Mexico chemistry teacher, is diagnosed with Stage III cancer...',
        status: 'Ended',
        tagline: 'Remember my name.',
        original_language: 'en',
        popularity: 600,
        vote_average: 8.9,
        vote_count: 12000,
        poster_path: '/poster.jpg',
        backdrop_path: '/backdrop.jpg',
        number_of_seasons: 5,
        number_of_episodes: 62,
        episode_run_time: [45, 47],
        in_production: false,
        type: 'Scripted',
        networks: [
            { id: 174, name: 'AMC' },
        ],
        production_companies: [
            { id: 2605, name: 'Gran Via Productions' },
            { id: 11073, name: 'High Bridge Entertainment' },
        ],
        production_countries: [{ iso_3166_1: 'US', name: 'United States of America' }],
        spoken_languages: [
            { iso_639_1: 'en', name: 'English', english_name: 'English' },
        ],
        genres: [
            { id: 18, name: 'Drama' },
            { id: 80, name: 'Crime' },
        ],
        keywords: {
            results: [
                { id: 1, name: 'drug' },
                { id: 2, name: 'cancer' },
            ],
        },
        credits: {
            cast: [
                { name: 'Bryan Cranston' },
                { name: 'Aaron Paul' },
            ],
            crew: [
                { job: 'Producer', name: 'Vince Gilligan' },
            ],
        },
        created_by: [
            { id: 66633, name: 'Vince Gilligan' },
        ],
        content_ratings: {
            results: [
                {
                    iso_3166_1: 'US',
                    rating: 'TV-MA',
                },
            ],
        },
        homepage: 'https://www.amc.com/shows/breaking-bad',
        ...overrides,
    };
}

describe('TvCatalogService', () => {
    it('supports TV shelf types', () => {
        const service = new TvCatalogService({ apiKey: 'fake' });
        expect(service.supportsShelfType('TV')).toBe(true);
        expect(service.supportsShelfType('tv')).toBe(true);
        expect(service.supportsShelfType('Television')).toBe(true);
        expect(service.supportsShelfType('TV Shows')).toBe(true);
        expect(service.supportsShelfType('Series')).toBe(true);
        expect(service.supportsShelfType('Movies')).toBe(false);
        expect(service.supportsShelfType('Books')).toBe(false);
    });

    it('maps TMDB TV payloads to Collectable documents', () => {
        const service = new TvCatalogService({ apiKey: 'fake' });
        const sampleTv = buildSampleTvShow();
        const entry = {
            status: 'resolved',
            enrichment: {
                provider: 'tmdb-tv',
                tv: sampleTv,
                score: 123.45,
            },
        };
        const item = { format: 'Blu-ray' };
        const lightweightFingerprint = 'lwf-value';

        const collectable = service.buildCollectablePayload(entry, item, lightweightFingerprint);

        expect(collectable.kind).toBe('tv');
        expect(collectable.type).toBe('tv');
        expect(collectable.title).toBe('Breaking Bad');
        expect(collectable.primaryCreator).toBe('Vince Gilligan');
        expect(collectable.publisher).toBe('AMC');
        expect(collectable.genre).toEqual(['Drama', 'Crime']);
        expect(collectable.tags).toEqual(['drug', 'cancer']);
        expect(collectable.identifiers.tmdb.tv).toEqual(['1396']);
        expect(collectable.sources[0].provider).toBe('tmdb');
        expect(collectable.sources[0].ids.tv).toBe('1396');
        expect(collectable.images.length).toBe(2);
        expect(collectable.extras.numberOfSeasons).toBe(5);
        expect(collectable.extras.numberOfEpisodes).toBe(62);
        expect(collectable.extras.runtime).toBe(45);
        expect(collectable.extras.contentRating.certification).toBe('TV-MA');
        expect(collectable.physical.format).toBe('Blu-ray');
        expect(collectable.lightweightFingerprint).toBe(lightweightFingerprint);
        expect(collectable.fingerprint).toBeTruthy();
        expect(collectable.attribution.logoKey).toBe('tmdb');
    });

    it('ranks TV show results correctly', () => {
        const service = new TvCatalogService({ apiKey: 'fake' });
        const results = [
            { id: 1, name: 'Breaking Bad', first_air_date: '2008-01-20', popularity: 600, vote_count: 12000, poster_path: '/a.jpg' },
            { id: 2, name: 'Breaking Bad 2', first_air_date: '2020-01-01', popularity: 50, vote_count: 100 },
            { id: 3, name: 'Breaking Good', first_air_date: '2008-01-20', popularity: 10, vote_count: 5 },
        ];

        const ranked = service.rankMatches(results, { title: 'Breaking Bad', year: 2008 });

        expect(ranked[0].id).toBe(1); // Exact title match + exact year + high popularity
        expect(ranked.length).toBe(3);
    });
});
