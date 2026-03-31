jest.mock('../database/pg', () => ({
  query: jest.fn(),
}));

jest.mock('../database/queries/media', () => ({
  ensureCoverMediaForCollectable: jest.fn(),
}));

jest.mock('../database/queries/jobRuns', () => ({
  appendJobEvent: jest.fn(),
}));

jest.mock('../context', () => ({
  getJobId: jest.fn(() => 'no-job'),
  getUserId: jest.fn(() => null),
}));

jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { query } = require('../database/pg');
const collectablesQueries = require('../database/queries/collectables');

describe('collectables search game platform filtering', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it('applies strict platform filter for game global search queries', async () => {
    await collectablesQueries.searchGlobal({
      q: 'Halo',
      kind: 'games',
      platform: 'Xbox',
      limit: 5,
      offset: 0,
    });

    const sql = query.mock.calls[0][0];
    const params = query.mock.calls[0][1];
    expect(sql).toContain("LOWER(COALESCE(c.system_name, '')) LIKE $5");
    expect(sql).toContain("jsonb_array_elements(COALESCE(c.platform_data, '[]'::jsonb))");
    expect(sql).toContain("LOWER(COALESCE(pd->>'abbreviation', '')) LIKE $5");
    expect(params).toEqual(expect.arrayContaining(['games', '%xbox%']));
  });

  it('does not apply platform filter for non-game kind searches', async () => {
    await collectablesQueries.searchGlobal({
      q: 'Dune',
      kind: 'books',
      platform: 'Xbox',
      limit: 5,
      offset: 0,
    });

    const sql = query.mock.calls[0][0];
    const params = query.mock.calls[0][1];
    expect(sql).not.toContain('jsonb_array_elements(COALESCE(c.platform_data');
    expect(params).not.toContain('%xbox%');
  });

  it('keeps stable placeholders when platform filter is not applied', async () => {
    await collectablesQueries.searchGlobal({
      q: 'Zelda',
      kind: 'books',
      limit: 10,
      offset: 20,
    });

    const sql = query.mock.calls[0][0];
    const params = query.mock.calls[0][1];
    expect(sql).toContain('LIMIT $5 OFFSET $6');
    expect(params).toHaveLength(6);
    expect(params[params.length - 2]).toBe(10);
    expect(params[params.length - 1]).toBe(20);
  });

  it('keeps stable wildcard placeholders when platform filter is not applied', async () => {
    await collectablesQueries.searchGlobalWildcard({
      pattern: 'Met*',
      kind: 'books',
      limit: 7,
      offset: 14,
    });

    const sql = query.mock.calls[0][0];
    const params = query.mock.calls[0][1];
    expect(sql).toContain('LIMIT $4 OFFSET $5');
    expect(params).toHaveLength(5);
    expect(params[params.length - 2]).toBe(7);
    expect(params[params.length - 1]).toBe(14);
  });
});
