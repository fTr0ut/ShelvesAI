'use strict';

const { query } = require('../pg');
const {
  createIntent,
  getByIdForUser,
  markCompleted,
  markFailed,
} = require('./itemReplacementTraces');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('itemReplacementTraces.createIntent', () => {
  it('inserts a new initiated trace', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 11,
        user_id: 'u1',
        shelf_id: 10,
        source_item_id: 44,
        source_collectable_id: 101,
        source_manual_id: null,
        trigger_source: 'collectable_detail',
        status: 'initiated',
      }],
      rowCount: 1,
    });

    const result = await createIntent({
      userId: 'u1',
      shelfId: 10,
      sourceItemId: 44,
      sourceCollectableId: 101,
      triggerSource: 'collectable_detail',
      metadata: { from: 'detail' },
    });

    expect(result).toEqual(expect.objectContaining({
      id: 11,
      userId: 'u1',
      sourceItemId: 44,
      status: 'initiated',
    }));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO item_replacement_traces'),
      expect.arrayContaining(['u1', 10, 44, 101, null, 'collectable_detail']),
    );
  });
});

describe('itemReplacementTraces.getByIdForUser', () => {
  it('builds status filter and FOR UPDATE when requested', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 12, user_id: 'u1', status: 'initiated' }],
      rowCount: 1,
    });

    await getByIdForUser({
      traceId: 12,
      userId: 'u1',
      shelfId: 10,
      sourceItemId: 44,
      status: 'initiated',
      forUpdate: true,
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('status = $5');
    expect(sql).toContain('FOR UPDATE');
    expect(params).toEqual([12, 'u1', 10, 44, 'initiated']);
  });
});

describe('itemReplacementTraces.markCompleted', () => {
  it('marks initiated trace as completed with target references', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 13,
        user_id: 'u1',
        status: 'completed',
        target_item_id: 55,
        target_collectable_id: 202,
      }],
      rowCount: 1,
    });

    const result = await markCompleted({
      traceId: 13,
      userId: 'u1',
      targetItemId: 55,
      targetCollectableId: 202,
      metadata: { replacedVia: 'search' },
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'completed',
      targetItemId: 55,
      targetCollectableId: 202,
    }));
    expect(query.mock.calls[0][0]).toContain("status = 'completed'");
  });
});

describe('itemReplacementTraces.markFailed', () => {
  it('marks initiated trace as failed with reason metadata', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 14,
        user_id: 'u1',
        status: 'failed',
      }],
      rowCount: 1,
    });

    const result = await markFailed({
      traceId: 14,
      userId: 'u1',
      reason: 'replacement_target_invalid',
      metadata: { code: 'invalid_payload' },
    });

    expect(result).toEqual(expect.objectContaining({
      id: 14,
      status: 'failed',
    }));
    expect(query.mock.calls[0][0]).toContain("status = 'failed'");
  });
});
