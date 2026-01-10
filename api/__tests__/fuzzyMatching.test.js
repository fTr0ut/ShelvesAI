const collectablesQueries = require('../database/queries/collectables');
const { query } = require('../database/pg');

jest.mock('../database/pg');
const { rowToCamelCase } = require('../database/queries/utils');

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
                combined_sim: 0.8
            }]
        });

        await collectablesQueries.fuzzyMatch('The Hobbit', 'Tolkien', 'book', 0.5);

        expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT *,') && expect.stringContaining('AND kind = $4'),
            ['The Hobbit', 'Tolkien', 0.5, 'book']
        );
    });

    it('should construct correct SQL without kind filter', async () => {
        query.mockResolvedValue({ rows: [] });

        await collectablesQueries.fuzzyMatch('The Hobbit', 'Tolkien', null, 0.5);

        // Check that sql does not contain "AND kind ="
        const callArgs = query.mock.calls[0];
        const sql = callArgs[0];
        expect(sql).not.toContain('AND kind =');
        expect(callArgs[1]).toEqual(['The Hobbit', 'Tolkien', 0.5]);
    });

    it('should match empty creator if not provided', async () => {
        query.mockResolvedValue({ rows: [] });
        await collectablesQueries.fuzzyMatch('Title', null, 'book');
        expect(query).toHaveBeenCalledWith(expect.any(String), ['Title', '', 0.3, 'book']);
    });

    it('should return null if combined_sim is below threshold', async () => {
        query.mockResolvedValue({
            rows: [{
                title: 'Something Else',
                combined_sim: 0.2
            }]
        });

        const result = await collectablesQueries.fuzzyMatch('Title', 'Author', 'book', 0.3);
        expect(result).toBeNull();
    });

    it('should return formatted result if match found', async () => {
        query.mockResolvedValue({
            rows: [{
                id: 1,
                title: 'The Hobbit',
                combined_sim: 0.8
            }]
        });

        const result = await collectablesQueries.fuzzyMatch('The Hobbit', 'Tolkien', 'book');
        expect(result).toEqual({ id: 1, title: 'The Hobbit', combinedSim: 0.8 });
    });
});
