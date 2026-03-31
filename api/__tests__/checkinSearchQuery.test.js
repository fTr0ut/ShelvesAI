const checkinRoutes = require('../routes/checkin');
const {
    buildCheckinSearchDedupKey,
    mergeCheckinSearchResults,
} = checkinRoutes._helpers;

describe('checkin search query builder', () => {
    it('builds normalized trigram query in default mode', () => {
        const { sql, params } = checkinRoutes._buildCheckinSearchQuery({
            q: 'Pokemon',
            userId: 'user-123',
            limit: 12,
            useWildcard: false,
        });

        expect(params).toEqual(['Pokemon', 'pokemon', 'user-123', 12]);
        expect(sql).toContain('similarity(c.title, $1)');
        expect(sql).toContain('source, system_name, platform_data');
        expect(sql).toContain('OR');
        expect(sql).toContain('% $2');
        expect(sql).toContain('ORDER BY score DESC NULLS LAST, title ASC');
    });

    it('builds normalized wildcard query when wildcard mode is used', () => {
        const { sql, params } = checkinRoutes._buildCheckinSearchQuery({
            q: 'Pok*mon',
            userId: 'user-123',
            limit: 7,
            useWildcard: true,
        });

        expect(params).toEqual(['Pok%mon', 'pok%mon', 'user-123', 7]);
        expect(sql).toContain('c.title ILIKE $1');
        expect(sql).toContain('source, system_name, platform_data');
        expect(sql).toContain('ILIKE $2');
        expect(sql).toContain('ORDER BY sort_title ASC');
    });

    it('adds strict local game platform filtering when a platform needle is provided', () => {
        const { sql, params } = checkinRoutes._buildCheckinSearchQuery({
            q: 'Halo',
            userId: 'user-123',
            limit: 10,
            useWildcard: false,
            platformFilterNeedle: '%xbox%',
        });

        expect(params).toEqual(['Halo', 'halo', 'user-123', '%xbox%', 10]);
        expect(sql).toContain("LOWER(COALESCE(c.system_name, '')) LIKE $4");
        expect(sql).toContain("jsonb_array_elements(COALESCE(c.platform_data, '[]'::jsonb))");
        expect(sql).toContain("LOWER(COALESCE(pd->>'abbreviation', '')) LIKE $4");
    });

    it('builds source-aware dedupe keys for manual/local/API entries', () => {
        expect(buildCheckinSearchDedupKey({ id: 7, source: 'manual' })).toBe('manual:7');
        expect(buildCheckinSearchDedupKey({ id: 7, source: 'collectable' })).toBe('collectable:7');
        expect(buildCheckinSearchDedupKey({ source: 'tmdb', externalId: '123' })).toBe('tmdb:ext:123');
        expect(buildCheckinSearchDedupKey({
            kind: 'movies',
            title: 'Inception',
            primaryCreator: 'Christopher Nolan',
        })).toBe('movies|inception|christopher nolan');
    });

    it('merges local + API check-in search results with dedupe and limit', () => {
        const merged = mergeCheckinSearchResults(
            [
                { id: 1, source: 'collectable', title: 'Dune' },
                { id: 1, source: 'manual', title: 'Dune notes' },
                { id: 2, source: 'collectable', title: 'Inception' },
            ],
            [
                { source: 'tmdb', externalId: 'tmdb:1', title: 'Dune', fromApi: true },
                { source: 'tmdb', externalId: 'tmdb:1', title: 'Dune duplicate', fromApi: true },
                { source: 'tmdb', externalId: 'tmdb:2', title: 'Memento', fromApi: true },
            ],
            4,
        );

        expect(merged).toHaveLength(4);
        expect(merged.map((entry) => entry.title)).toEqual([
            'Dune',
            'Dune notes',
            'Inception',
            'Dune',
        ]);
    });
});
