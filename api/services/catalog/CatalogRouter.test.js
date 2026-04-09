'use strict';

const { CatalogRouter } = require('./CatalogRouter');
const { MetadataScorer } = require('./MetadataScorer');
const { CatalogProvidersUnavailableError } = require('./errors');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(results) {
    let callIndex = 0;
    return {
        isConfigured: () => true,
        lookup: jest.fn(async () => {
            const result = results[callIndex] ?? null;
            callIndex++;
            return result;
        }),
    };
}

function makeThrowingAdapter(error) {
    return {
        isConfigured: () => true,
        lookup: jest.fn(async () => {
            throw error;
        }),
    };
}

function makeConfig(containerType, mode = 'fallback') {
    return {
        [containerType]: {
            mode,
            apis: [
                { name: 'api1', enabled: true, priority: 1 },
                { name: 'api2', enabled: true, priority: 2 },
            ],
        },
    };
}

// ---------------------------------------------------------------------------
// CatalogRouter._lookupFallback — universal scoring
// ---------------------------------------------------------------------------

describe('CatalogRouter._lookupFallback — universal scoring via MetadataScorer', () => {
    let router;
    let adapter1;
    let adapter2;

    function setupRouter(containerType, adapter1Results, adapter2Results, mode = 'fallback') {
        router = new CatalogRouter({ config: makeConfig(containerType, mode) });
        adapter1 = makeAdapter(adapter1Results);
        adapter2 = makeAdapter(adapter2Results);
        router._adapterFactories = {
            api1: () => adapter1,
            api2: () => adapter2,
        };
    }

    // -----------------------------------------------------------------------
    // Books — backward compatibility
    // -----------------------------------------------------------------------

    describe('books — backward compatibility', () => {
        it('returns first result immediately when score meets threshold', async () => {
            const highScoreBook = {
                title: 'The Great Gatsby',
                primaryCreator: 'F. Scott Fitzgerald',
                publishers: ['Scribner'],
                year: '1925',
                description:
                    'The Great Gatsby is a 1925 novel by American writer F. Scott Fitzgerald. Set in the Jazz Age on Long Island, near New York City.',
                coverImageUrl: 'https://example.com/cover.jpg',
                identifiers: { isbn13: '9780743273565' },
                tags: ['fiction', 'classic'],
            };

            setupRouter('books', [highScoreBook], []);

            const result = await router.lookup(highScoreBook, 'books');

            expect(result).not.toBeNull();
            expect(result._source).toBe('api1');
            expect(result._metadataScore).toBeDefined();
            expect(result._metadataMissing).toBeDefined();
            // api2 should not have been called
            expect(adapter2.lookup).not.toHaveBeenCalled();
        });

        it('falls through to api2 when api1 score is below threshold', async () => {
            const lowScoreBook = {
                title: 'The Great Gatsby',
                primaryCreator: 'F. Scott Fitzgerald',
            }; // score will be very low, but still relevant
            const highScoreBook = {
                title: 'The Great Gatsby',
                primaryCreator: 'F. Scott Fitzgerald',
                publishers: ['Scribner'],
                year: '1925',
                description:
                    'The Great Gatsby is a 1925 novel by American writer F. Scott Fitzgerald. Set in the Jazz Age on Long Island, near New York City.',
                coverImageUrl: 'https://example.com/cover.jpg',
                identifiers: { isbn13: '9780743273565' },
                tags: ['fiction', 'classic'],
            };

            setupRouter('books', [lowScoreBook], [highScoreBook]);

            const result = await router.lookup(lowScoreBook, 'books');

            expect(result).not.toBeNull();
            expect(result._source).toBe('api2');
            expect(result._metadataScore).toBeDefined();
        });

        it('returns null when all book candidates are below threshold and irrelevant', async () => {
            const weakQuery = { title: 'Player', author: 'Kandi Steiner' };
            const lowBook1 = { title: "Scoring the Player's Baby", primaryCreator: 'Kandi Steiner' };
            const lowBook2 = { title: 'Played', primaryCreator: 'Other Author' };

            setupRouter('books', [lowBook1], [lowBook2]);

            const result = await router.lookup(weakQuery, 'books');

            expect(result).toBeNull();
        });

        it('rejects a high-metadata but irrelevant book candidate before scoring fallback', async () => {
            const weakQuery = { title: 'Player', author: 'Kandi Steiner' };
            const irrelevantCandidate = {
                title: "Scoring the Player's Baby",
                primaryCreator: 'Kandi Steiner',
                publishers: ['Example House'],
                year: '2025',
                description: 'A complete metadata payload for the wrong book candidate.',
                coverImageUrl: 'https://example.com/cover.jpg',
                identifiers: { isbn13: '9781234567890' },
                tags: ['romance'],
            };

            setupRouter('books', [irrelevantCandidate], []);

            const result = await router.lookup(weakQuery, 'books');

            expect(result).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Non-book types — new scoring behavior
    // -----------------------------------------------------------------------

    describe('movies — now scored via MetadataScorer', () => {
        it('attaches _metadataScore and _metadataMissing to movie results', async () => {
            const movie = {
                title: 'Inception',
                primaryCreator: 'Christopher Nolan',
                year: '2010',
                description:
                    'A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.',
                coverImageUrl: 'https://example.com/inception.jpg',
                identifiers: { tmdb: '27205' },
                tags: ['action', 'sci-fi'],
                runtime: 148,
                extras: { certification: 'PG-13' },
            };

            setupRouter('movies', [movie], []);

            const result = await router.lookup(movie, 'movies');

            expect(result).not.toBeNull();
            expect(result._metadataScore).toBeDefined();
            expect(typeof result._metadataScore).toBe('number');
            expect(result._metadataMissing).toBeDefined();
            expect(Array.isArray(result._metadataMissing)).toBe(true);
        });

        it('falls through to api2 when movie score is below threshold', async () => {
            const lowScoreMovie = { title: 'Unknown Movie' }; // very low score
            const highScoreMovie = {
                title: 'Inception',
                primaryCreator: 'Christopher Nolan',
                year: '2010',
                description:
                    'A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.',
                coverImageUrl: 'https://example.com/inception.jpg',
                identifiers: { tmdb: '27205' },
                tags: ['action', 'sci-fi'],
                runtime: 148,
                extras: { certification: 'PG-13' },
            };

            setupRouter('movies', [lowScoreMovie], [highScoreMovie]);

            const result = await router.lookup(lowScoreMovie, 'movies');

            expect(result).not.toBeNull();
            expect(result._source).toBe('api2');
        });
    });

    describe('games — now scored via MetadataScorer', () => {
        it('attaches _metadataScore and _metadataMissing to game results', async () => {
            const game = {
                title: 'The Legend of Zelda',
                primaryCreator: 'Nintendo',
                year: '1986',
                description:
                    'The Legend of Zelda is an action-adventure game developed and published by Nintendo.',
                coverImageUrl: 'https://example.com/zelda.jpg',
                identifiers: { igdb: '1234' },
                tags: ['adventure', 'action'],
                systemName: 'NES',
            };

            setupRouter('games', [game], []);

            const result = await router.lookup(game, 'games');

            expect(result).not.toBeNull();
            expect(result._metadataScore).toBeDefined();
            expect(typeof result._metadataScore).toBe('number');
            expect(result._metadataMissing).toBeDefined();
        });
    });

    describe('vinyl — now scored via MetadataScorer', () => {
        it('attaches _metadataScore and _metadataMissing to vinyl results', async () => {
            const album = {
                title: 'Kind of Blue',
                primaryCreator: 'Miles Davis',
                year: '1959',
                description:
                    'Kind of Blue is a studio album by American jazz musician Miles Davis.',
                coverImageUrl: 'https://example.com/kob.jpg',
                identifiers: { musicbrainz: 'abc123' },
                tags: ['jazz'],
            };

            setupRouter('vinyl', [album], []);

            const result = await router.lookup(album, 'vinyl');

            expect(result).not.toBeNull();
            expect(result._metadataScore).toBeDefined();
            expect(typeof result._metadataScore).toBe('number');
            expect(result._metadataMissing).toBeDefined();
        });

        it('falls through to second API for stronger vinyl metadata', async () => {
            const lowScoreVinyl = {
                title: 'Kind of Blue',
                description: 'Jazz album',
            };
            const higherScoreVinyl = {
                title: 'Kind of Blue',
                primaryCreator: 'Miles Davis',
                year: '1959',
                description: 'A seminal jazz album.',
                coverImageUrl: 'https://example.com/kob.jpg',
                identifiers: { discogs: { release: ['249504'] } },
                tags: ['jazz'],
            };

            setupRouter('vinyl', [lowScoreVinyl], [higherScoreVinyl]);

            const result = await router.lookup(lowScoreVinyl, 'vinyl');

            expect(result).not.toBeNull();
            expect(result._source).toBe('api2');
            expect(result._metadataScore).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // Unknown container type — accept first non-null result (no scoring)
    // -----------------------------------------------------------------------

    describe('unknown container type — no scoring, accept first result', () => {
        it('returns first non-null result without _metadataScore for unknown type', async () => {
            const unknownConfig = {
                unknown_type: {
                    mode: 'fallback',
                    apis: [{ name: 'api1', enabled: true, priority: 1 }],
                },
            };
            router = new CatalogRouter({ config: unknownConfig });
            const mockResult = { title: 'Something' };
            adapter1 = makeAdapter([mockResult]);
            router._adapterFactories = { api1: () => adapter1 };

            // MetadataScorer returns null for unknown types, so shouldScore = false
            const scorer = new MetadataScorer();
            expect(scorer.getMinScore('unknown_type')).toBeNull();

            const result = await router.lookup(mockResult, 'unknown_type');

            expect(result).not.toBeNull();
            expect(result._source).toBe('api1');
            // No scoring for unknown types
            expect(result._metadataScore).toBeUndefined();
            expect(result._metadataMissing).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    describe('edge cases', () => {
        it('returns null when all APIs return null', async () => {
            setupRouter('books', [null], [null]);

            const result = await router.lookup({}, 'books');

            expect(result).toBeNull();
        });

        it('continues to next API when adapter throws', async () => {
            const goodResult = {
                title: 'Good Book',
                primaryCreator: 'Author',
                publishers: ['Publisher'],
                year: '2020',
                description:
                    'A very good book with a long enough description to get partial credit here.',
                coverImageUrl: 'https://example.com/cover.jpg',
                identifiers: { isbn13: '9780000000000' },
                tags: ['fiction'],
            };

            router = new CatalogRouter({ config: makeConfig('books') });
            adapter1 = { isConfigured: () => true, lookup: jest.fn().mockRejectedValue(new Error('Network error')) };
            adapter2 = makeAdapter([goodResult]);
            router._adapterFactories = { api1: () => adapter1, api2: () => adapter2 };

            const result = await router.lookup({}, 'books');

            expect(result).not.toBeNull();
            expect(result._source).toBe('api2');
        });

        it('skips unconfigured adapters', async () => {
            const goodResult = { title: 'Good Book' };

            router = new CatalogRouter({ config: makeConfig('books') });
            adapter1 = { isConfigured: () => false, lookup: jest.fn() };
            adapter2 = makeAdapter([goodResult]);
            router._adapterFactories = { api1: () => adapter1, api2: () => adapter2 };

            const result = await router.lookup({}, 'books');

            expect(adapter1.lookup).not.toHaveBeenCalled();
            expect(result).not.toBeNull();
        });
    });

    describe('provider circuit breaker', () => {
        it('trips provider on first hard error and skips provider on later lookups in same context', async () => {
            const hardError = new Error('OpenLibrary request failed with 503');
            router = new CatalogRouter({ config: makeConfig('books') });
            adapter1 = makeThrowingAdapter(hardError);
            adapter2 = makeAdapter([
                {
                    title: 'Fallback One',
                    primaryCreator: 'Author',
                    publishers: ['Pub'],
                    year: '2024',
                    description: 'Fallback metadata with enough detail for score.',
                    coverImageUrl: 'https://example.com/fallback-1.jpg',
                },
                {
                    title: 'Fallback Two',
                    primaryCreator: 'Author',
                    publishers: ['Pub'],
                    year: '2024',
                    description: 'Fallback metadata with enough detail for score.',
                    coverImageUrl: 'https://example.com/fallback-2.jpg',
                },
            ]);
            router._adapterFactories = { api1: () => adapter1, api2: () => adapter2 };

            const catalogContext = { jobId: 'job-1' };
            await router.lookup({ title: 'Book A' }, 'books', { catalogContext });
            await router.lookup({ title: 'Book B' }, 'books', { catalogContext });

            expect(adapter1.lookup).toHaveBeenCalledTimes(1);
            expect(adapter2.lookup).toHaveBeenCalledTimes(2);
        });

        it('does not trip provider on null no-result responses', async () => {
            router = new CatalogRouter({ config: makeConfig('books') });
            adapter1 = makeAdapter([null, null]);
            adapter2 = makeAdapter([null, null]);
            router._adapterFactories = { api1: () => adapter1, api2: () => adapter2 };

            const catalogContext = { jobId: 'job-2' };
            await router.lookup({ title: 'Book A' }, 'books', { catalogContext });
            await router.lookup({ title: 'Book B' }, 'books', { catalogContext });

            expect(adapter1.lookup).toHaveBeenCalledTimes(2);
            expect(adapter2.lookup).toHaveBeenCalledTimes(2);
        });

        it('throws unavailable error when all configured providers are tripped', async () => {
            router = new CatalogRouter({ config: makeConfig('books') });
            adapter1 = makeThrowingAdapter(new Error('OpenLibrary request failed with 503'));
            adapter2 = makeThrowingAdapter(new Error('Hardcover API failed with status 503'));
            router._adapterFactories = { api1: () => adapter1, api2: () => adapter2 };

            const catalogContext = { jobId: 'job-3' };

            await expect(
                router.lookup({ title: 'Book A' }, 'books', { catalogContext })
            ).rejects.toMatchObject({ code: 'CATALOG_PROVIDERS_UNAVAILABLE' });

            await expect(
                router.lookup({ title: 'Book B' }, 'books', { catalogContext })
            ).rejects.toBeInstanceOf(CatalogProvidersUnavailableError);
        });
    });
});
