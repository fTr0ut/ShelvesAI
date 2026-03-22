'use strict';

const { randomUUID } = require('crypto');
const { store } = require('../context');
const logger = require('../logger');
const {
  startJobRun,
  completeJobRun,
  failJobRun,
  appendJobEvent,
} = require('../database/queries/jobRuns');

async function safeDbWrite(operation, action) {
  try {
    await operation;
  } catch (err) {
    if (err && err.code === '42P01') return;
    logger.warn(`[jobRunner] ${action} failed`, { error: err.message });
  }
}

/**
 * Wraps a scheduled job function with a unique jobId context.
 * All log calls inside `fn` (and anything it calls) will automatically
 * include the jobId via AsyncLocalStorage.
 *
 * @param {string} name  Short job name, e.g. 'newsCache'
 * @param {Function} fn  Async function to run
 */
async function runJob(name, fn) {
  const jobId = `job_${name}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const startedAt = new Date();
  const start = startedAt.getTime();

  await safeDbWrite(
    startJobRun({
      jobId,
      jobType: 'scheduled',
      jobName: name,
      startedAt,
      metadata: { source: 'scheduler' },
    }),
    'startJobRun'
  );
  await safeDbWrite(
    appendJobEvent({
      jobId,
      level: 'info',
      message: 'Scheduled job started',
      metadata: { name },
      createdAt: startedAt,
    }),
    'append start event'
  );

  await store.run({ jobId }, async () => {
    logger.info(`[${name}] Job started`, { jobId });
    try {
      await fn();
      const durationMs = Date.now() - start;
      logger.info(`[${name}] Job completed`, { durationMs });
      await safeDbWrite(
        completeJobRun({
          jobId,
          success: true,
          durationMs,
          metadata: { name },
        }),
        'completeJobRun'
      );
      await safeDbWrite(
        appendJobEvent({
          jobId,
          level: 'info',
          message: 'Scheduled job completed',
          metadata: { durationMs },
        }),
        'append complete event'
      );
    } catch (err) {
      const durationMs = Date.now() - start;
      logger.error(`[${name}] Job failed`, {
        error: err.message,
        stack: err.stack,
        durationMs,
      });
      await safeDbWrite(
        failJobRun({
          jobId,
          durationMs,
          errorMessage: err.message,
          metadata: { name },
        }),
        'failJobRun'
      );
      await safeDbWrite(
        appendJobEvent({
          jobId,
          level: 'error',
          message: 'Scheduled job failed',
          metadata: {
            error: err.message,
            durationMs,
          },
        }),
        'append failed event'
      );
    }
  });
}

module.exports = { runJob };
