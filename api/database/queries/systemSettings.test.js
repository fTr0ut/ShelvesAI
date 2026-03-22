'use strict';

// database/pg is mocked globally in __tests__/setup.js
const { query } = require('../pg');
const { getSetting, upsertSetting, deleteSetting, getAllSettings } = require('./systemSettings');

beforeEach(() => {
    jest.clearAllMocks();
});

const USER_ID_1 = '11111111-1111-4111-8111-111111111111';
const USER_ID_2 = '22222222-2222-4222-8222-222222222222';
const USER_ID_3 = '33333333-3333-4333-8333-333333333333';

// ---------------------------------------------------------------------------
// getSetting
// ---------------------------------------------------------------------------

describe('getSetting()', () => {
    it('returns camelCase row when found', async () => {
        query.mockResolvedValueOnce({
            rows: [{
                key: 'metadata_score_config',
                value: { books: {} },
                description: 'Scoring config',
                updated_by: USER_ID_1,
                created_at: new Date('2026-01-01'),
                updated_at: new Date('2026-01-02'),
            }],
            rowCount: 1,
        });

        const result = await getSetting('metadata_score_config');

        expect(result).not.toBeNull();
        expect(result.key).toBe('metadata_score_config');
        expect(result.value).toEqual({ books: {} });
        expect(result.description).toBe('Scoring config');
        expect(result.updatedBy).toBe(USER_ID_1);
        expect(result.createdAt).toBeDefined();
        expect(result.updatedAt).toBeDefined();
    });

    it('returns null when key not found', async () => {
        query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const result = await getSetting('nonexistent');

        expect(result).toBeNull();
    });

    it('queries with the correct key parameter', async () => {
        query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        await getSetting('my_key');

        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('WHERE key = $1'),
            ['my_key']
        );
    });
});

// ---------------------------------------------------------------------------
// upsertSetting
// ---------------------------------------------------------------------------

describe('upsertSetting()', () => {
    it('returns the upserted row as camelCase', async () => {
        query.mockResolvedValueOnce({
            rows: [{
                key: 'foo',
                value: { x: 1 },
                description: null,
                updated_by: null,
                created_at: new Date(),
                updated_at: new Date(),
            }],
            rowCount: 1,
        });

        const result = await upsertSetting('foo', { x: 1 });

        expect(result).not.toBeNull();
        expect(result.key).toBe('foo');
        expect(result.value).toEqual({ x: 1 });
    });

    it('passes description and updatedBy to the query', async () => {
        query.mockResolvedValueOnce({
            rows: [{
                key: 'bar',
                value: {},
                description: 'A description',
                updated_by: USER_ID_2,
                created_at: new Date(),
                updated_at: new Date(),
            }],
            rowCount: 1,
        });

        await upsertSetting('bar', {}, { description: 'A description', updatedBy: USER_ID_2 });

        const callArgs = query.mock.calls[0];
        expect(callArgs[1]).toContain('A description');
        expect(callArgs[1]).toContain(USER_ID_2);
    });

    it('defaults description and updatedBy to null when not provided', async () => {
        query.mockResolvedValueOnce({
            rows: [{
                key: 'baz',
                value: {},
                description: null,
                updated_by: null,
                created_at: new Date(),
                updated_at: new Date(),
            }],
            rowCount: 1,
        });

        await upsertSetting('baz', {});

        const callArgs = query.mock.calls[0];
        expect(callArgs[1][2]).toBeNull(); // description
        expect(callArgs[1][3]).toBeNull(); // updatedBy
    });
});

// ---------------------------------------------------------------------------
// deleteSetting
// ---------------------------------------------------------------------------

describe('deleteSetting()', () => {
    it('returns true when a row was deleted', async () => {
        query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const result = await deleteSetting('foo');

        expect(result).toBe(true);
    });

    it('returns false when key was not found', async () => {
        query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const result = await deleteSetting('nonexistent');

        expect(result).toBe(false);
    });

    it('queries with the correct key parameter', async () => {
        query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        await deleteSetting('my_key');

        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('WHERE key = $1'),
            ['my_key']
        );
    });
});

// ---------------------------------------------------------------------------
// getAllSettings
// ---------------------------------------------------------------------------

describe('getAllSettings()', () => {
    it('returns an empty array when no settings exist', async () => {
        query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const result = await getAllSettings();

        expect(result).toEqual([]);
    });

    it('returns all rows as camelCase objects', async () => {
        query.mockResolvedValueOnce({
            rows: [
                {
                    key: 'a',
                    value: { x: 1 },
                    description: null,
                    updated_by: null,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
                {
                    key: 'b',
                    value: { y: 2 },
                    description: 'desc',
                    updated_by: USER_ID_3,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            ],
            rowCount: 2,
        });

        const result = await getAllSettings();

        expect(result).toHaveLength(2);
        expect(result[0].key).toBe('a');
        expect(result[0].value).toEqual({ x: 1 });
        expect(result[1].key).toBe('b');
        expect(result[1].updatedBy).toBe(USER_ID_3);
    });
});
