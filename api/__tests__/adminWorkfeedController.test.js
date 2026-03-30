'use strict';

jest.mock('../database/queries/workflowQueueJobs');
jest.mock('../services/processingStatus', () => ({
  getJob: jest.fn(),
}));

const workflowQueueJobsQueries = require('../database/queries/workflowQueueJobs');
const processingStatus = require('../services/processingStatus');
const adminController = require('../controllers/adminController');

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeRes() {
  return {
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
}

function makeReq(overrides = {}) {
  return {
    user: { id: ADMIN_ID, isAdmin: true },
    params: {},
    query: {},
    body: {},
    headers: {},
    get: jest.fn().mockReturnValue(null),
    socket: { remoteAddress: '127.0.0.1' },
    ip: '127.0.0.1',
    ...overrides,
  };
}

describe('adminController workfeed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('listWorkfeed defaults to active filter and merges progress snapshot', async () => {
    workflowQueueJobsQueries.listAdminWorkfeed.mockResolvedValue({
      jobs: [
        {
          jobId: 'wf_vision_test123',
          workflowType: 'vision',
          status: 'processing',
          queuePosition: '0',
          queuedMs: '1250',
          attemptCount: '1',
          maxAttempts: '1',
        },
      ],
      total: 1,
      hasMore: false,
    });
    processingStatus.getJob.mockReturnValue({
      step: 'matching',
      progress: 42,
      message: 'Matching candidates',
    });

    const req = makeReq({ query: {} });
    const res = makeRes();

    await adminController.listWorkfeed(req, res);

    expect(workflowQueueJobsQueries.listAdminWorkfeed).toHaveBeenCalledWith(
      expect.objectContaining({
        status: null,
      })
    );
    expect(res.json).toHaveBeenCalledWith({
      jobs: [
        expect.objectContaining({
          jobId: 'wf_vision_test123',
          queuePosition: 0,
          queuedMs: 1250,
          step: 'matching',
          progress: 42,
          message: 'Matching candidates',
        }),
      ],
      pagination: expect.objectContaining({
        total: 1,
        hasMore: false,
      }),
    });
  });

  test('listWorkfeed validates shelfId', async () => {
    const req = makeReq({ query: { shelfId: 'abc' } });
    const res = makeRes();

    await adminController.listWorkfeed(req, res);

    expect(workflowQueueJobsQueries.listAdminWorkfeed).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid shelfId' });
  });

  test('getWorkfeedJob returns 404 when missing', async () => {
    workflowQueueJobsQueries.getAdminWorkfeedJob.mockResolvedValue(null);

    const req = makeReq({ params: { jobId: 'missing-job' } });
    const res = makeRes();

    await adminController.getWorkfeedJob(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Job not found' });
  });

  test('getWorkfeedJob returns hydrated job payload', async () => {
    workflowQueueJobsQueries.getAdminWorkfeedJob.mockResolvedValue({
      jobId: 'wf_vision_abc123',
      workflowType: 'vision',
      status: 'queued',
      queuePosition: '2',
      queuedMs: '10000',
      attemptCount: '0',
      maxAttempts: '1',
      payload: { shelfId: 10 },
      result: null,
      error: null,
    });
    processingStatus.getJob.mockReturnValue({
      step: 'queued',
      progress: 0,
      message: 'Queued for processing',
    });

    const req = makeReq({ params: { jobId: 'wf_vision_abc123' } });
    const res = makeRes();

    await adminController.getWorkfeedJob(req, res);

    expect(res.json).toHaveBeenCalledWith({
      job: expect.objectContaining({
        jobId: 'wf_vision_abc123',
        queuePosition: 2,
        queuedMs: 10000,
        step: 'queued',
        progress: 0,
        message: 'Queued for processing',
      }),
    });
  });
});

