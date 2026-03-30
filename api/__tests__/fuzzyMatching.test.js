const collectablesQueries = require('../database/queries/collectables');
const { query } = require('../database/pg');

jest.mock('../database/pg');

describe('collectablesQueries.fuzzyMatch', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return null if no title provided', async () => {
        const result = await collectablesQueries.fuzzyMatch(null, 'Author', 'book');
        expect(result).toBeNull();
    });

    it('should construct correct SQL with kind filter', async () => {
        query.mockResolvedValue({
            rows: [{
                title: 'The Hobbit',
                combined_sim: 0.8,
            }],
        });

        await collectablesQueries.fuzzyMatch('The Hobbit', 'Tolkien', 'book', 0.5);

        expect(query).toHaveBeenCalledWith(expect.stringContaining('AND c.kind = $6'),
            ['The Hobbit', 'Tolkien', 'the hobbit', 'tolkien', 0.5, 'books']
        );
    });

    it('should construct correct SQL without kind filter', async () => {
        query.mockResolvedValue({ rows: [] });

        await collectablesQueries.fuzzyMatch('The Hobbit', 'Tolkien', null, 0.5);

        const callArgs = query.mock.calls[0];
        const sql = callArgs[0];
        expect(sql).not.toContain('AND kind =');
        expect(callArgs[1]).toEqual(['The Hobbit', 'Tolkien', 'the hobbit', 'tolkien', 0.5]);
    });

    it('should match empty creator if not provided', async () => {
        query.mockResolvedValue({ rows: [] });
        await collectablesQueries.fuzzyMatch('Title', null, 'book');
        expect(query).toHaveBeenCalledWith(expect.any(String), ['Title', '', 'title', '', 0.3, 'books']);
    });

    it('should return null if combined_sim is below threshold', async () => {
        query.mockResolvedValue({
            rows: [{
                title: 'Something Else',
                combined_sim: 0.2,
            }],
        });

        const result = await collectablesQueries.fuzzyMatch('Title', 'Author', 'book', 0.3);
        expect(result).toBeNull();
    });

    it('should return formatted result if match found', async () => {
        query.mockResolvedValue({
            rows: [{
                id: 1,
                title: 'The Hobbit',
                combined_sim: 0.8,
            }],
        });

        const result = await collectablesQueries.fuzzyMatch('The Hobbit', 'Tolkien', 'book');
        expect(result).toEqual({ id: 1, title: 'The Hobbit', combinedSim: 0.8 });
    });
});

describe('collectablesQueries search normalization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('searchByTitle should include normalized matching branch', async () => {
        query.mockResolvedValue({ rows: [] });

        await collectablesQueries.searchByTitle('Pokemon', 'book', 7);

        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain('WHERE (');
        expect(sql).toContain('c.title % $1');
        expect(sql).toContain(') % $2');
        expect(sql).toContain(')');
        expect(sql).toContain('AND c.kind = $3');
        expect(params).toEqual(['Pokemon', 'pokemon', 'books', 7]);
    });

    it('searchGlobal should include normalized branch and ranking', async () => {
        query.mockResolvedValue({ rows: [] });

        await collectablesQueries.searchGlobal({ q: 'Pokemon', kind: 'book', limit: 5, offset: 2 });

        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain('WHERE (');
        expect(sql).toContain('OR COALESCE(c.primary_creator, \'\') % $1');
        expect(sql).toContain('% $2');
        expect(sql).toContain('OR c.cast_members @> $3::jsonb');
        expect(sql).toContain('AND c.kind = $4');
        expect(sql).toContain('ORDER BY search_score DESC');
        expect(params).toEqual(['Pokemon', 'pokemon', '[{"nameNormalized":"pokemon"}]', 'books', 5, 2]);
    });

    it('searchGlobalWildcard should include normalized ILIKE branch', async () => {
        query.mockResolvedValue({ rows: [] });

        await collectablesQueries.searchGlobalWildcard({ pattern: 'Pok*mon', kind: 'book', limit: 4, offset: 1 });

        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain('WHERE (');
        expect(sql).toContain('OR c.primary_creator ILIKE $1');
        expect(sql).toContain('ILIKE $2');
        expect(sql).toContain('AND c.kind = $3');
        expect(params).toEqual(['Pok%mon', 'pok%mon', 'books', 4, 1]);
    });
});
