'use strict';

const { query } = require('../pg');
const { addCollectable, addManualCollection } = require('./shelves');

beforeEach(() => {
    jest.clearAllMocks();
});

describe('shelves queries write guards', () => {
    describe('addCollectable', () => {
        it('uses conflict do-nothing path when no mutable fields are provided', async () => {
            query.mockResolvedValueOnce({
                rows: [{ id: 101, user_id: 'user-1', shelf_id: 9, collectable_id: 88 }],
                rowCount: 1,
            });

            const result = await addCollectable({
                userId: 'user-1',
                shelfId: 9,
                collectableId: 88,
                format: null,
                notes: null,
                rating: null,
                position: null,
            });

            expect(result?.id).toBe(101);
            expect(query).toHaveBeenCalledTimes(1);
            expect(query.mock.calls[0][0]).toContain('DO NOTHING');
            expect(query.mock.calls[0][0]).not.toContain('DO UPDATE');
        });

        it('returns existing row when conflict-do-nothing insert returns no row', async () => {
            query
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({
                    rows: [{ id: 102, user_id: 'user-1', shelf_id: 9, collectable_id: 88 }],
                    rowCount: 1,
                });

            const result = await addCollectable({
                userId: 'user-1',
                shelfId: 9,
                collectableId: 88,
                format: null,
                notes: null,
                rating: null,
                position: null,
            });

            expect(result?.id).toBe(102);
            expect(query).toHaveBeenCalledTimes(2);
            expect(query.mock.calls[0][0]).toContain('DO NOTHING');
            expect(query.mock.calls[1][0]).toContain('WHERE user_id = $1 AND shelf_id = $2 AND collectable_id = $3');
        });

        it('uses conflict update path when mutable fields are provided', async () => {
            query.mockResolvedValueOnce({
                rows: [{ id: 103, notes: 'updated' }],
                rowCount: 1,
            });

            const result = await addCollectable({
                userId: 'user-1',
                shelfId: 9,
                collectableId: 88,
                notes: 'updated',
            });

            expect(result?.id).toBe(103);
            expect(query).toHaveBeenCalledTimes(1);
            expect(query.mock.calls[0][0]).toContain('DO UPDATE');
        });

        it('defaults platform_missing to false when not provided', async () => {
            query.mockResolvedValueOnce({
                rows: [{ id: 104 }],
                rowCount: 1,
            });

            await addCollectable({
                userId: 'user-1',
                shelfId: 9,
                collectableId: 88,
                notes: 'only-notes',
            });

            expect(query).toHaveBeenCalledTimes(1);
            expect(query.mock.calls[0][0]).toContain('WHEN $9::boolean THEN EXCLUDED.platform_missing');
            expect(query.mock.calls[0][1][4]).toBe(false);
            expect(query.mock.calls[0][1][8]).toBe(false);
        });

        it('updates platform_missing when explicitly provided', async () => {
            query.mockResolvedValueOnce({
                rows: [{ id: 105, platform_missing: true }],
                rowCount: 1,
            });

            await addCollectable({
                userId: 'user-1',
                shelfId: 9,
                collectableId: 88,
                platformMissing: true,
            });

            expect(query).toHaveBeenCalledTimes(1);
            expect(query.mock.calls[0][1][4]).toBe(true);
            expect(query.mock.calls[0][1][8]).toBe(true);
        });
    });

    describe('addManualCollection', () => {
        it('uses conflict do-nothing then returns existing row on conflict', async () => {
            query
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({
                    rows: [{ id: 201, user_id: 'user-2', shelf_id: 5, manual_id: 44 }],
                    rowCount: 1,
                });

            const result = await addManualCollection({
                userId: 'user-2',
                shelfId: 5,
                manualId: 44,
            });

            expect(result?.id).toBe(201);
            expect(query).toHaveBeenCalledTimes(2);
            expect(query.mock.calls[0][0]).toContain('DO NOTHING');
            expect(query.mock.calls[1][0]).toContain('WHERE user_id = $1 AND shelf_id = $2 AND manual_id = $3');
        });
    });
});
