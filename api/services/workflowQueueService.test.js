jest.mock('../database/queries/workflowQueueJobs', () => ({
  claimNextRunnable: jest.fn(),
  markCompleted: jest.fn(),
  markFailedOrRequeue: jest.fn(),
  cleanupTerminalJobs: jest.fn().mockResolvedValue(0),
  isAbortRequested: jest.fn().mockResolvedValue(false),
}));

jest.mock('../database/queries/notifications', () => ({
  create: jest.fn().mockResolvedValue({ id: 'n1' }),
}));

jest.mock('./workflow/workflowSettings', () => ({
  getWorkflowQueueSettings: jest.fn().mockResolvedValue({
    workflowQueueMaxRunning: 2,
    workflowQueueMaxRunningPerUser: 1,
    workflowQueueMaxQueuedPerUser: 4,
    workflowQueueLongThresholdPosition: 3,
    workflowQueueNotifyMinWaitMs: 20000,
    workflowQueueRetryMaxAttempts: 1,
    workflowQueueTerminalRetentionMs: 24 * 60 * 60 * 1000,
  }),
}));

jest.mock('./processingStatus', () => ({
  setJob: jest.fn(),
  failJob: jest.fn(),
  abortJob: jest.fn(),
}));

const workflowQueueJobs = require('../database/queries/workflowQueueJobs');
const notifications = require('../database/queries/notifications');
const processingStatus = require('./processingStatus');
const { WorkflowQueueService } = require('./workflowQueueService');

describe('WorkflowQueueService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkflowQueueService();
  });

  test('executeJob marks job completed on success', async () => {
    const job = {
      jobId: 'wf-job-1',
      workflowType: 'vision',
      userId: 'u1',
      shelfId: 10,
      notifyOnComplete: false,
      payload: { shelfId: 10 },
    };
    workflowQueueJobs.markCompleted.mockResolvedValue({
      ...job,
      status: 'completed',
      notifyOnComplete: false,
    });

    const handler = jest.fn().mockResolvedValue({ summaryMessage: 'done' });
    await service.executeJob(job, handler);

    expect(handler).toHaveBeenCalledWith(job, expect.objectContaining({
      shouldAbort: expect.any(Function),
    }));
    expect(workflowQueueJobs.markCompleted).toHaveBeenCalledWith({
      jobId: 'wf-job-1',
      result: { summaryMessage: 'done' },
    });
    expect(notifications.create).not.toHaveBeenCalled();
  });

  test('executeJob requeues transient failure without workflow_failed notification', async () => {
    const job = {
      jobId: 'wf-job-2',
      workflowType: 'vision',
      userId: 'u1',
      shelfId: 10,
      notifyOnComplete: true,
      payload: { shelfId: 10 },
    };
    workflowQueueJobs.markFailedOrRequeue.mockResolvedValue({
      ...job,
      status: 'queued',
      notifyOnComplete: true,
    });

    const handler = jest.fn().mockRejectedValue(new Error('network hiccup'));
    await service.executeJob(job, handler);

    expect(workflowQueueJobs.markFailedOrRequeue).toHaveBeenCalledWith({
      jobId: 'wf-job-2',
      error: expect.objectContaining({ message: 'network hiccup' }),
    });
    expect(processingStatus.setJob).toHaveBeenCalledWith('wf-job-2', expect.objectContaining({
      status: 'queued',
    }));
    expect(notifications.create).not.toHaveBeenCalled();
  });

  test('executeJob sends workflow_failed notification on terminal failure when opted in', async () => {
    const job = {
      jobId: 'wf-job-3',
      workflowType: 'vision',
      userId: 'u1',
      shelfId: 10,
      notifyOnComplete: true,
      payload: { shelfId: 10 },
    };
    workflowQueueJobs.markFailedOrRequeue.mockResolvedValue({
      ...job,
      status: 'failed',
      notifyOnComplete: true,
      error: { message: 'Vision provider unavailable' },
    });

    const handler = jest.fn().mockRejectedValue(new Error('Vision provider unavailable'));
    await service.executeJob(job, handler);

    expect(processingStatus.failJob).toHaveBeenCalledWith('wf-job-3', 'Vision provider unavailable');
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1',
      type: 'workflow_failed',
      entityType: 'workflow_job',
      entityId: 'wf-job-3',
    }));
  });
});
