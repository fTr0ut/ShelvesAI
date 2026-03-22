const { query } = require('../pg');
const { appendJobEvent } = require('./jobRuns');

describe('jobRuns.appendJobEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('inserts event only when parent job_run exists', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const inserted = await appendJobEvent({
      jobId: 'req_abc12345',
      level: 'info',
      message: 'Request started',
      metadata: { method: 'GET' },
    });

    expect(inserted).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('WHERE EXISTS (SELECT 1 FROM job_runs WHERE job_id = $1)');
  });

  test('returns false without throwing when parent job_run is missing', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const inserted = await appendJobEvent({
      jobId: 'req_missing',
      level: 'warn',
      message: 'Request finished',
      metadata: { status: 404 },
    });

    expect(inserted).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
