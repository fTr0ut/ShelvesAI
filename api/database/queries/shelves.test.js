'use strict';

const { query } = require('../pg');
const {
    addCollectable,
    addManualCollection,
    findLatestAccessibleCollectionItemByReference,
} = require('./shelves');

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

describe('findLatestAccessibleCollectionItemByReference', () => {
    it('hydrates the latest owned collectable item using normalized owner ids', async () => {
        query
            .mockResolvedValueOnce({
                rows: [{ item_id: 301, shelf_id: 9 }],
                rowCount: 1,
            })
            .mockResolvedValueOnce({
                rows: [{
                    id: 301,
                    user_id: '3f5a1bc1-1111-4f11-9a11-5e5f11111111',
                    shelf_id: 9,
                    collectable_id: 88,
                }],
                rowCount: 1,
            });

        const result = await findLatestAccessibleCollectionItemByReference({
            viewerUserId: '3f5a1bc1-1111-4f11-9a11-5e5f11111111',
            requestedOwnerId: '3f5a1bc1-1111-4f11-9a11-5e5f11111111',
            collectableId: 88,
        });

        expect(result).toEqual(expect.objectContaining({
            owned: true,
            viewable: false,
            shelfId: 9,
            itemId: 301,
            item: expect.objectContaining({
                id: 301,
                userId: '3f5a1bc1-1111-4f11-9a11-5e5f11111111',
                shelfId: 9,
                collectableId: 88,
            }),
        }));
        expect(query.mock.calls[0][1]).toEqual([
            '3f5a1bc1-1111-4f11-9a11-5e5f11111111',
            88,
        ]);
        expect(query.mock.calls[1][1]).toEqual([
            301,
            '3f5a1bc1-1111-4f11-9a11-5e5f11111111',
            9,
        ]);
    });

    it('hydrates the latest accessible foreign manual item without coercing uuid owner ids', async () => {
        query
            .mockResolvedValueOnce({
                rows: [{ item_id: 401, shelf_id: 12 }],
                rowCount: 1,
            })
            .mockResolvedValueOnce({
                rows: [{
                    id: 401,
                    user_id: '9b4a6b0c-2222-4f22-8b22-4d4d22222222',
                    shelf_id: 12,
                    manual_id: 77,
                    notes: 'Owner note',
                }],
                rowCount: 1,
            });

        const result = await findLatestAccessibleCollectionItemByReference({
            viewerUserId: 'viewer-7',
            requestedOwnerId: '9b4a6b0c-2222-4f22-8b22-4d4d22222222',
            manualId: 77,
        });

        expect(result).toEqual(expect.objectContaining({
            owned: false,
            viewable: true,
            shelfId: 12,
            itemId: 401,
            item: expect.objectContaining({
                id: 401,
                userId: '9b4a6b0c-2222-4f22-8b22-4d4d22222222',
                shelfId: 12,
                manualId: 77,
            }),
        }));
        expect(query.mock.calls[0][0]).toContain('JOIN shelves s ON s.id = uc.shelf_id');
        expect(query.mock.calls[0][1]).toEqual([
            '9b4a6b0c-2222-4f22-8b22-4d4d22222222',
            77,
            'viewer-7',
        ]);
        expect(query.mock.calls[1][1]).toEqual([401, 12]);
    });

    it('returns null when no accessible foreign item exists', async () => {
        query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const result = await findLatestAccessibleCollectionItemByReference({
            viewerUserId: 'viewer-7',
            requestedOwnerId: 'owner-9',
            collectableId: 99,
        });

        expect(result).toBeNull();
        expect(query).toHaveBeenCalledTimes(1);
    });
});
