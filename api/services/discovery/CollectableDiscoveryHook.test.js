/**
 * Unit tests for CollectableDiscoveryHook
 */

const { CollectableDiscoveryHook } = require('./CollectableDiscoveryHook');

// Mock dependencies
jest.mock('../../database/queries/collectables', () => ({
    findByLightweightFingerprint: jest.fn(),
    findByFingerprint: jest.fn(),
    upsert: jest.fn()
}));

jest.mock('../collectables/fingerprint', () => ({
    makeCollectableFingerprint: jest.fn(() => 'mock-fingerprint-123'),
    makeLightweightFingerprint: jest.fn(() => 'mock-lwf-456')
}));

const collectablesQueries = require('../../database/queries/collectables');
const { makeCollectableFingerprint, makeLightweightFingerprint } = require('../collectables/fingerprint');

describe('CollectableDiscoveryHook', () => {
    let hook;

    beforeEach(() => {
        hook = new CollectableDiscoveryHook({ enabled: true });
        jest.clearAllMocks();
    });

    describe('processEnrichedItem', () => {
        const mockBlurayItem = {
            title: 'The Matrix',
            source_url: 'https://www.blu-ray.com/movies/The-Matrix-4K/12345/',
            release_date: new Date('2026-03-15'),
            format: '4K'
        };

        const mockTmdbData = {
            id: 603,
            title: 'The Matrix',
            original_title: 'The Matrix',
            overview: 'A computer hacker learns about the true nature of reality.',
            poster_path: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
            release_date: '1999-03-30',
            genre_ids: [28, 878]
        };

        it('should return disabled when hook is disabled', async () => {
            const disabledHook = new CollectableDiscoveryHook({ enabled: false });

            const result = await disabledHook.processEnrichedItem({
                source: 'bluray',
                kind: 'movie',
                enrichment: mockTmdbData,
                originalItem: mockBlurayItem
            });

            expect(result.status).toBe('disabled');
        });

        it('should skip items without a title', async () => {
            const result = await hook.processEnrichedItem({
                source: 'bluray',
                kind: 'movie',
                enrichment: null,
                originalItem: {}
            });

            expect(result.status).toBe('skipped');
            expect(result.reason).toBe('no_title');
        });

        it('should return existing collectable on fingerprint match', async () => {
            const existingCollectable = { id: 999, title: 'The Matrix' };
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(existingCollectable);

            const result = await hook.processEnrichedItem({
                source: 'bluray',
                kind: 'movie',
                enrichment: mockTmdbData,
                originalItem: mockBlurayItem
            });

            expect(result.status).toBe('exists');
            expect(result.collectable).toEqual(existingCollectable);
            expect(collectablesQueries.upsert).not.toHaveBeenCalled();
        });

        it('should create new collectable when no match exists', async () => {
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
            collectablesQueries.findByFingerprint.mockResolvedValue(null);

            const createdCollectable = { id: 1001, title: 'The Matrix' };
            collectablesQueries.upsert.mockResolvedValue(createdCollectable);

            const result = await hook.processEnrichedItem({
                source: 'bluray',
                kind: 'movie',
                enrichment: mockTmdbData,
                originalItem: mockBlurayItem
            });

            expect(result.status).toBe('created');
            expect(result.collectable).toEqual(createdCollectable);
            expect(collectablesQueries.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    fingerprint: 'mock-fingerprint-123',
                    lightweightFingerprint: 'mock-lwf-456',
                    kind: 'movie',
                    title: 'The Matrix'
                })
            );
        });

        it('should generate correct fingerprints', async () => {
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
            collectablesQueries.findByFingerprint.mockResolvedValue(null);
            collectablesQueries.upsert.mockResolvedValue({ id: 1 });

            await hook.processEnrichedItem({
                source: 'bluray',
                kind: 'movie',
                enrichment: mockTmdbData,
                originalItem: mockBlurayItem
            });

            expect(makeCollectableFingerprint).toHaveBeenCalledWith({
                title: 'The Matrix',
                primaryCreator: undefined,
                releaseYear: 1999,
                mediaType: 'movie'
            });

            expect(makeLightweightFingerprint).toHaveBeenCalledWith({
                title: 'The Matrix',
                kind: 'movie'
            });
        });
    });

    describe('buildPayload', () => {
        describe('Bluray source', () => {
            it('should build payload from TMDB enrichment', () => {
                const payload = hook.buildPayload({
                    source: 'bluray',
                    kind: 'movie',
                    enrichment: {
                        id: 603,
                        title: 'The Matrix',
                        overview: 'Hacker discovers truth',
                        poster_path: '/matrix.jpg',
                        release_date: '1999-03-30'
                    },
                    originalItem: {
                        title: 'Matrix 4K',
                        format: '4K',
                        source_url: 'https://blu-ray.com/test'
                    }
                });

                expect(payload.title).toBe('The Matrix');
                expect(payload.description).toBe('Hacker discovers truth');
                expect(payload.year).toBe(1999);
                expect(payload.formats).toEqual(['4K']);
                expect(payload.identifiers.tmdb).toBe('603');
                expect(payload.identifiers.bluray_url).toBe('https://blu-ray.com/test');
            });

            it('should build minimal payload without TMDB match', () => {
                const payload = hook.buildPayload({
                    source: 'bluray',
                    kind: 'movie',
                    enrichment: null,
                    originalItem: {
                        title: 'Unknown Movie',
                        format: 'Blu-ray',
                        source_url: 'https://blu-ray.com/test'
                    }
                });

                expect(payload.title).toBe('Unknown Movie');
                expect(payload.formats).toEqual(['Blu-ray']);
                expect(payload.identifiers.bluray_url).toBe('https://blu-ray.com/test');
            });
        });

        describe('IGDB source', () => {
            it('should build payload from IGDB enrichment', () => {
                const payload = hook.buildPayload({
                    source: 'igdb',
                    kind: 'game',
                    enrichment: {
                        id: 1942,
                        name: 'The Witcher 3: Wild Hunt',
                        summary: 'Open-world RPG',
                        first_release_date: 1431993600, // Unix timestamp
                        cover: { url: '//images.igdb.com/cover.jpg' },
                        genres: [{ name: 'RPG' }],
                        platforms: [{ name: 'PC' }, { name: 'PlayStation 4' }]
                    },
                    originalItem: {}
                });

                expect(payload.title).toBe('The Witcher 3: Wild Hunt');
                expect(payload.description).toBe('Open-world RPG');
                expect(payload.year).toBe(2015);
                expect(payload.formats).toEqual(['PC', 'PlayStation 4']);
                expect(payload.tags).toEqual(['RPG']);
                expect(payload.identifiers.igdb).toBe('1942');
            });
        });

        describe('TMDB source', () => {
            it('should build payload from direct TMDB data', () => {
                const payload = hook.buildPayload({
                    source: 'tmdb',
                    kind: 'movie',
                    enrichment: {
                        id: 550,
                        title: 'Fight Club',
                        overview: 'An insomniac forms an underground fight club.',
                        poster_path: '/fightclub.jpg',
                        release_date: '1999-10-15'
                    },
                    originalItem: {}
                });

                expect(payload.title).toBe('Fight Club');
                expect(payload.year).toBe(1999);
                expect(payload.externalId).toBe('tmdb:550');
            });

            it('should handle TV shows', () => {
                const payload = hook.buildPayload({
                    source: 'tmdb',
                    kind: 'tv',
                    enrichment: {
                        id: 1399,
                        name: 'Game of Thrones',
                        overview: 'Fantasy drama series.',
                        poster_path: '/got.jpg',
                        first_air_date: '2011-04-17'
                    },
                    originalItem: {}
                });

                expect(payload.title).toBe('Game of Thrones');
                expect(payload.year).toBe(2011);
            });
        });
    });

    describe('error handling', () => {
        it('should handle dedupe query errors gracefully', async () => {
            collectablesQueries.findByLightweightFingerprint.mockRejectedValue(new Error('DB error'));
            collectablesQueries.upsert.mockResolvedValue({ id: 1 });

            const result = await hook.processEnrichedItem({
                source: 'bluray',
                kind: 'movie',
                enrichment: { title: 'Test', id: 1 },
                originalItem: { title: 'Test' }
            });

            // Should still attempt upsert after dedupe error
            expect(collectablesQueries.upsert).toHaveBeenCalled();
            expect(result.status).toBe('created');
        });

        it('should return error status on upsert failure', async () => {
            collectablesQueries.findByLightweightFingerprint.mockResolvedValue(null);
            collectablesQueries.findByFingerprint.mockResolvedValue(null);
            collectablesQueries.upsert.mockRejectedValue(new Error('Upsert failed'));

            const result = await hook.processEnrichedItem({
                source: 'bluray',
                kind: 'movie',
                enrichment: { title: 'Test', id: 1 },
                originalItem: { title: 'Test' }
            });

            expect(result.status).toBe('error');
            expect(result.reason).toBe('Upsert failed');
        });
    });
});
