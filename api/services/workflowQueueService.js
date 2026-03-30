const workflowQueueJobs = require('../database/queries/workflowQueueJobs');
const notificationsQueries = require('../database/queries/notifications');
const logger = require('../logger');
const { getWorkflowQueueSettings } = require('./workflow/workflowSettings');
const processingStatus = require('./processingStatus');

const POLL_INTERVAL_MS = Number.parseInt(process.env.WORKFLOW_QUEUE_POLL_INTERVAL_MS || '400', 10);
const CLEANUP_INTERVAL_MS = Number.parseInt(process.env.WORKFLOW_QUEUE_CLEANUP_INTERVAL_MS || String(15 * 60 * 1000), 10);

class WorkflowQueueService {
  constructor() {
    this.handlers = new Map();
    this.started = false;
    this.pollTimer = null;
    this.cleanupTimer = null;
    this.tickInFlight = false;
  }

  registerHandler(workflowType, handler) {
    if (!workflowType || typeof handler !== 'function') {
      throw new Error('registerHandler requires workflowType and function handler');
    }
    this.handlers.set(String(workflowType), handler);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.pollTimer = setInterval(() => {
      this.tick().catch((err) => {
        logger.error('[WorkflowQueue] tick failed', { error: err?.message || err });
      });
    }, Math.max(100, POLL_INTERVAL_MS));
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((err) => {
        logger.warn('[WorkflowQueue] cleanup failed', { error: err?.message || err });
      });
    }, Math.max(60000, CLEANUP_INTERVAL_MS));

    this.tick().catch((err) => {
      logger.error('[WorkflowQueue] startup tick failed', { error: err?.message || err });
    });
    logger.info('[WorkflowQueue] service started');
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    logger.info('[WorkflowQueue] service stopped');
  }

  async tick() {
    if (!this.started) return;
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      const settings = await getWorkflowQueueSettings();
      for (const [workflowType, handler] of this.handlers.entries()) {
        let claimed = 0;
        const maxClaimsPerTick = Math.max(1, settings.workflowQueueMaxRunning * 2);
        while (claimed < maxClaimsPerTick) {
          const job = await workflowQueueJobs.claimNextRunnable({
            workflowType,
            maxRunning: settings.workflowQueueMaxRunning,
            maxRunningPerUser: settings.workflowQueueMaxRunningPerUser,
          });
          if (!job) break;
          claimed += 1;
          this.executeJob(job, handler).catch((err) => {
            logger.error('[WorkflowQueue] executeJob unhandled failure', {
              workflowType,
              jobId: job.jobId,
              error: err?.message || err,
            });
          });
        }
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  async executeJob(job, handler) {
    const workflowType = job.workflowType;
    const startedAt = Date.now();
    try {
      const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
      const result = await handler(job, {
        shouldAbort: async () => workflowQueueJobs.isAbortRequested(job.jobId),
      });

      const completed = await workflowQueueJobs.markCompleted({
        jobId: job.jobId,
        result: result || {},
      });
      await this.maybeSendTerminalNotification({
        job: completed,
        type: 'workflow_complete',
      });

      logger.info('[WorkflowQueue] job completed', {
        workflowType,
        jobId: job.jobId,
        durationMs: Date.now() - startedAt,
        shelfId: payload.shelfId || job.shelfId || null,
      });
    } catch (err) {
      const errorPayload = {
        message: String(err?.message || 'Workflow failed'),
        code: err?.code || null,
      };
      const updated = await workflowQueueJobs.markFailedOrRequeue({
        jobId: job.jobId,
        error: errorPayload,
      });
      if (updated?.status === 'queued') {
        processingStatus.setJob(job.jobId, {
          jobId: job.jobId,
          userId: updated.userId || job.userId,
          shelfId: updated.shelfId || job.shelfId || null,
          status: 'queued',
          step: 'queued',
          progress: 0,
          message: 'Requeued after transient failure',
          aborted: false,
          result: null,
        });
      } else if (updated?.status === 'aborted') {
        processingStatus.abortJob(job.jobId, { preserveStatus: false, message: 'Processing cancelled by user' });
      } else {
        processingStatus.failJob(job.jobId, errorPayload.message);
      }
      if (updated && ['failed', 'aborted'].includes(updated.status)) {
        await this.maybeSendTerminalNotification({
          job: updated,
          type: 'workflow_failed',
        });
      }
      logger.warn('[WorkflowQueue] job failed', {
        workflowType,
        jobId: job.jobId,
        status: updated?.status || null,
        durationMs: Date.now() - startedAt,
        error: errorPayload.message,
      });
    }
  }

  async maybeSendTerminalNotification({ job, type }) {
    if (!job || job.notifyOnComplete !== true) return;
    const metadata = {
      workflowType: job.workflowType,
      shelfId: job.shelfId || null,
      status: job.status,
      summaryMessage: job.result?.summaryMessage || job.error?.message || null,
    };

    try {
      await notificationsQueries.create({
        userId: job.userId,
        actorId: null,
        type,
        entityId: job.jobId,
        entityType: 'workflow_job',
        metadata,
      });
    } catch (err) {
      logger.warn('[WorkflowQueue] failed to create workflow notification', {
        jobId: job.jobId,
        type,
        error: err?.message || err,
      });
    }
  }

  async cleanup() {
    if (!this.started) return;
    const settings = await getWorkflowQueueSettings();
    const deleted = await workflowQueueJobs.cleanupTerminalJobs({
      olderThanMs: settings.workflowQueueTerminalRetentionMs,
    });
    if (deleted > 0) {
      logger.info('[WorkflowQueue] cleaned up terminal jobs', { deleted });
    }
  }
}

let instance = null;

function getWorkflowQueueService() {
  if (!instance) {
    instance = new WorkflowQueueService();
  }
  return instance;
}

module.exports = {
  WorkflowQueueService,
  getWorkflowQueueService,
};
