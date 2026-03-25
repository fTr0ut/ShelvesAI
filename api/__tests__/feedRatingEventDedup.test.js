function createFeedHarness() {
  const eventAggregates = [];
  const eventLogs = [];
  const shelves = new Map([[10, { id: 10, visibility: 'public' }]]);
  let aggregateSeq = 1;
  let logSeq = 1;

  const scopeLocks = new Map();

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function acquireScopeLock(userKey, scopeKey) {
    const key = `${userKey}:${scopeKey}`;
    const previous = scopeLocks.get(key);
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    scopeLocks.set(key, current);
    if (previous) await previous;
    return () => {
      if (scopeLocks.get(key) === current) {
        scopeLocks.delete(key);
      }
      release();
    };
  }

  function toDate(value) {
    return value instanceof Date ? value : new Date(value);
  }

  function isActiveAggregate(aggregate) {
    return toDate(aggregate.window_end_utc).getTime() >= Date.now();
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  async function execute(sql, params, clientContext) {
    if (sql.includes('SELECT visibility FROM shelves WHERE id = $1')) {
      const shelf = shelves.get(Number(params[0]));
      return { rows: shelf ? [{ visibility: shelf.visibility }] : [], rowCount: shelf ? 1 : 0 };
    }

    if (sql.includes('SELECT pg_advisory_xact_lock')) {
      const release = await acquireScopeLock(params[0], params[1]);
      if (clientContext) clientContext.releases.push(release);
      return { rows: [{ pg_advisory_xact_lock: true }], rowCount: 1 };
    }

    if (sql.includes('FROM event_aggregates') && sql.includes('window_end_utc >= NOW()') && sql.includes('FOR UPDATE')) {
      await wait(5);
      let candidates = eventAggregates.filter(isActiveAggregate);
      if (sql.includes('shelf_id IS NULL')) {
        candidates = candidates.filter((a) => String(a.user_id) === String(params[0]) && a.shelf_id == null && a.event_type === params[1]);
      } else if (sql.includes("event_type LIKE 'item.%'")) {
        candidates = candidates.filter((a) => String(a.user_id) === String(params[0]) && Number(a.shelf_id) === Number(params[1]) && a.event_type.startsWith('item.'));
      } else {
        candidates = candidates.filter((a) => String(a.user_id) === String(params[0]) && Number(a.shelf_id) === Number(params[1]) && a.event_type === params[2]);
      }
      candidates.sort((a, b) => toDate(b.window_end_utc) - toDate(a.window_end_utc));
      return { rows: candidates[0] ? [deepClone(candidates[0])] : [], rowCount: candidates[0] ? 1 : 0 };
    }

    if (sql.includes('INSERT INTO event_aggregates')) {
      const row = {
        id: `agg-${aggregateSeq++}`,
        user_id: params[0],
        shelf_id: params[1],
        event_type: params[2],
        window_start_utc: new Date(),
        window_end_utc: new Date(Date.now() + Number(params[3]) * 60000),
        item_count: 0,
        preview_payloads: [],
        created_at: new Date(),
        last_activity_at: new Date(),
      };
      eventAggregates.push(row);
      return { rows: [deepClone(row)], rowCount: 1 };
    }

    if (sql.includes('FROM event_logs') && sql.includes("event_type = 'item.rated'") && sql.includes('FOR UPDATE')) {
      const [aggregateId, collectableId, manualId, itemId] = params.map((v) => (v == null ? null : String(v)));
      const filtered = eventLogs
        .filter((log) => log.aggregate_id === aggregateId && log.event_type === 'item.rated')
        .filter((log) => {
          const payload = log.payload || {};
          if (collectableId && (String(payload.collectableId ?? payload.collectable_id ?? '') === collectableId)) return true;
          if (manualId && (String(payload.manualId ?? payload.manual_id ?? '') === manualId)) return true;
          if (itemId && (String(payload.itemId ?? payload.id ?? '') === itemId)) return true;
          return false;
        })
        .sort((a, b) => toDate(b.created_at) - toDate(a.created_at));
      return {
        rows: filtered[0] ? [{ id: filtered[0].id }] : [],
        rowCount: filtered[0] ? 1 : 0,
      };
    }

    if (sql.includes('UPDATE event_logs') && sql.includes('SET payload = $2::jsonb')) {
      const [eventLogId, payloadJson] = params;
      const target = eventLogs.find((row) => row.id === eventLogId);
      if (!target) return { rows: [], rowCount: 0 };
      target.payload = JSON.parse(payloadJson);
      target.created_at = new Date();
      return { rows: [deepClone(target)], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO event_logs')) {
      const payload = JSON.parse(params[4]);
      const row = {
        id: `log-${logSeq++}`,
        user_id: params[0],
        shelf_id: params[1],
        aggregate_id: params[2],
        event_type: params[3],
        payload,
        created_at: new Date(),
      };
      eventLogs.push(row);
      return { rows: [deepClone(row)], rowCount: 1 };
    }

    if (sql.includes('WITH counts AS') && sql.includes('UPDATE event_aggregates a')) {
      const [aggregateId, previewLimit] = params;
      const aggregate = eventAggregates.find((row) => row.id === aggregateId);
      if (!aggregate) return { rows: [], rowCount: 0 };
      const ratedLogs = eventLogs
        .filter((row) => row.aggregate_id === aggregateId && row.event_type === 'item.rated')
        .sort((a, b) => toDate(b.created_at) - toDate(a.created_at));
      aggregate.item_count = ratedLogs.length;
      aggregate.preview_payloads = ratedLogs.slice(0, Number(previewLimit)).map((row) => deepClone(row.payload));
      aggregate.last_activity_at = new Date();
      return { rows: [deepClone(aggregate)], rowCount: 1 };
    }

    if (sql.includes('UPDATE event_aggregates') && sql.includes('SET item_count = item_count + $1')) {
      const [itemIncrement, previewLimit, payloadJson, aggregateId] = params;
      const aggregate = eventAggregates.find((row) => row.id === aggregateId);
      if (!aggregate) return { rows: [], rowCount: 0 };
      aggregate.item_count += Number(itemIncrement);
      aggregate.last_activity_at = new Date();
      if ((aggregate.preview_payloads || []).length < Number(previewLimit)) {
        aggregate.preview_payloads = [...(aggregate.preview_payloads || []), JSON.parse(payloadJson)];
      }
      return { rows: [deepClone(aggregate)], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in test harness: ${sql}`);
  }

  const pgMock = {
    query: jest.fn((sql, params = []) => execute(sql, params)),
    transaction: jest.fn(async (fn) => {
      const ctx = { releases: [] };
      const client = {
        query: jest.fn((sql, params = []) => execute(sql, params, ctx)),
      };
      try {
        return await fn(client);
      } finally {
        ctx.releases.reverse().forEach((release) => release());
      }
    }),
  };

  return { pgMock, eventAggregates, eventLogs };
}

function loadFeedQueriesWithHarness() {
  const harness = createFeedHarness();
  jest.resetModules();
  jest.doMock('../database/pg', () => harness.pgMock);
  jest.doMock('../logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));
  const feedQueries = require('../database/queries/feed');
  return { feedQueries, harness };
}

describe('feedQueries item.rated deduplication', () => {
  afterEach(() => {
    jest.dontMock('../database/pg');
    jest.dontMock('../logger');
  });

  it('keeps one log entry for repeated same-value ratings on the same item', async () => {
    const { feedQueries, harness } = loadFeedQueriesWithHarness();

    await feedQueries.logEvent({
      userId: 'u1',
      shelfId: null,
      eventType: 'item.rated',
      payload: { collectableId: 101, title: 'A', rating: 4 },
    });
    await feedQueries.logEvent({
      userId: 'u1',
      shelfId: null,
      eventType: 'item.rated',
      payload: { collectableId: 101, title: 'A', rating: 4 },
    });

    expect(harness.eventAggregates).toHaveLength(1);
    expect(harness.eventLogs).toHaveLength(1);
    expect(harness.eventAggregates[0].item_count).toBe(1);
    expect(harness.eventAggregates[0].preview_payloads).toHaveLength(1);
    expect(harness.eventAggregates[0].preview_payloads[0].rating).toBe(4);
  });

  it('updates the existing item entry when rating value changes in the same window', async () => {
    const { feedQueries, harness } = loadFeedQueriesWithHarness();

    await feedQueries.logEvent({
      userId: 'u1',
      shelfId: null,
      eventType: 'item.rated',
      payload: { collectableId: 101, title: 'A', rating: 3.5 },
    });
    await feedQueries.logEvent({
      userId: 'u1',
      shelfId: null,
      eventType: 'item.rated',
      payload: { collectableId: 101, title: 'A', rating: 4.5 },
    });

    expect(harness.eventAggregates).toHaveLength(1);
    expect(harness.eventLogs).toHaveLength(1);
    expect(harness.eventAggregates[0].item_count).toBe(1);
    expect(harness.eventAggregates[0].preview_payloads[0].rating).toBe(4.5);
  });

  it('keeps multiple unique items in one aggregate with unique item_count', async () => {
    const { feedQueries, harness } = loadFeedQueriesWithHarness();

    await feedQueries.logEvent({
      userId: 'u1',
      shelfId: null,
      eventType: 'item.rated',
      payload: { collectableId: 101, title: 'A', rating: 4 },
    });
    await feedQueries.logEvent({
      userId: 'u1',
      shelfId: null,
      eventType: 'item.rated',
      payload: { collectableId: 202, title: 'B', rating: 5 },
    });

    expect(harness.eventAggregates).toHaveLength(1);
    expect(harness.eventLogs).toHaveLength(2);
    expect(harness.eventAggregates[0].item_count).toBe(2);
    expect(harness.eventAggregates[0].preview_payloads).toHaveLength(2);
  });

  it('serializes concurrent same-scope rating writes into one aggregate', async () => {
    const { feedQueries, harness } = loadFeedQueriesWithHarness();

    await Promise.all([
      feedQueries.logEvent({
        userId: 'u1',
        shelfId: null,
        eventType: 'item.rated',
        payload: { collectableId: 101, title: 'A', rating: 4 },
      }),
      feedQueries.logEvent({
        userId: 'u1',
        shelfId: null,
        eventType: 'item.rated',
        payload: { collectableId: 202, title: 'B', rating: 5 },
      }),
    ]);

    expect(harness.eventAggregates).toHaveLength(1);
    expect(harness.eventAggregates[0].item_count).toBe(2);
  });
});
