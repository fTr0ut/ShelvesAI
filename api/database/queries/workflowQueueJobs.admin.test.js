'use strict';

jest.mock('../pg', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const { query } = require('../pg');
const workflowQueueJobs = require('./workflowQueueJobs');

describe('workflowQueueJobs admin workfeed queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('listAdminWorkfeed defaults to active status filter and active sort', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            job_id: 'wf_vision_1',
            workflow_type: 'vision',
            status: 'queued',
            queue_position: 1,
            queued_ms: 2500,
          },
        ],
      });

    const result = await workflowQueueJobs.listAdminWorkfeed({
      limit: 50,
      offset: 0,
    });

    const countSql = query.mock.calls[0][0];
    const countParams = query.mock.calls[0][1];
    const dataSql = query.mock.calls[1][0];

    expect(countSql).toContain('j.status = ANY');
    expect(countParams[0]).toEqual(['queued', 'processing']);
    expect(dataSql).toContain("WHEN j.status = 'processing' THEN 0");
    expect(dataSql).toContain('AS queue_position');
    expect(dataSql).toContain('AS queued_ms');
    expect(result.total).toBe(1);
    expect(result.jobs[0]).toEqual(
      expect.objectContaining({
        jobId: 'wf_vision_1',
        workflowType: 'vision',
        queuePosition: 1,
      })
    );
  });

  test('listAdminWorkfeed uses non-active sort when status is all', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await workflowQueueJobs.listAdminWorkfeed({
      status: 'all',
      limit: 25,
      offset: 0,
    });

    const countSql = query.mock.calls[0][0];
    const countParams = query.mock.calls[0][1];
    const dataSql = query.mock.calls[1][0];

    expect(countSql).not.toContain('j.status = ANY');
    expect(countParams).toEqual([]);
    expect(dataSql).toContain('ORDER BY j.updated_at DESC, j.job_id DESC');
  });

  test('listAdminWorkfeed applies explicit terminal status filter', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await workflowQueueJobs.listAdminWorkfeed({
      status: 'failed',
      limit: 50,
      offset: 0,
    });

    const countSql = query.mock.calls[0][0];
    const countParams = query.mock.calls[0][1];

    expect(countSql).toContain('j.status = ANY');
    expect(countParams[0]).toEqual(['failed']);
  });

  test('getAdminWorkfeedJob selects derived queue fields', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          job_id: 'wf_job_1',
          status: 'processing',
          queue_position: 0,
          queued_ms: 5000,
        },
      ],
    });

    const job = await workflowQueueJobs.getAdminWorkfeedJob('wf_job_1');

    const sql = query.mock.calls[0][0];
    const params = query.mock.calls[0][1];
    expect(sql).toContain('AS queue_position');
    expect(sql).toContain('AS queued_ms');
    expect(params).toEqual(['wf_job_1']);
    expect(job).toEqual(
      expect.objectContaining({
        jobId: 'wf_job_1',
        queuedMs: 5000,
      })
    );
  });
});

