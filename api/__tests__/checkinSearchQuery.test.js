const checkinRoutes = require('../routes/checkin');

describe('checkin search query builder', () => {
    it('builds normalized trigram query in default mode', () => {
        const { sql, params } = checkinRoutes._buildCheckinSearchQuery({
            q: 'Pokémon',
            userId: 'user-123',
            limit: 12,
            useWildcard: false,
        });

        expect(params).toEqual(['Pokémon', 'pokemon', 'user-123', 12]);
        expect(sql).toContain('similarity(c.title, $1)');
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
        expect(sql).toContain('ILIKE $2');
        expect(sql).toContain('ORDER BY sort_title ASC');
    });
});
