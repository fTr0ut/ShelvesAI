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

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || '-';
}

function safeAsync(promise, operation) {
  promise.catch((err) => {
    if (err && err.code === '42P01') return;
    logger.warn(`[requestLogger] ${operation} failed`, { error: err.message });
  });
}

function requestLogger(req, res, next) {
  const jobId = 'req_' + randomUUID().replace(/-/g, '').slice(0, 8);
  const startedAt = new Date();
  const startTime = process.hrtime.bigint();
  const ip = getClientIp(req);

  store.run({ jobId }, () => {
    req.jobId = jobId;
    const runReady = startJobRun({
      jobId,
      jobType: 'request',
      jobName: `${req.method} ${req.originalUrl}`,
      httpMethod: req.method,
      httpPath: req.originalUrl,
      ipAddress: ip,
      metadata: {
        userAgent: req.get('user-agent') || null,
        referer: req.get('referer') || null,
      },
      startedAt,
    })
      .then(() => true)
      .catch((err) => {
        if (err && err.code === '42P01') return false;
        logger.warn('[requestLogger] startJobRun failed', { error: err.message });
        return false;
      });

    safeAsync(
      runReady.then((ready) => {
        if (!ready) return null;
        return appendJobEvent({
          jobId,
          level: 'info',
          message: 'Request started',
          metadata: {
            method: req.method,
            path: req.originalUrl,
          },
          createdAt: startedAt,
        });
      }),
      'append start event'
    );

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      const roundedDurationMs = Math.round(durationMs);
      const userId = req.user?.id || null;
      const success = res.statusCode >= 200 && res.statusCode < 400;
      const logMetadata = {
        status: res.statusCode,
        durationMs: parseFloat(durationMs.toFixed(2)),
        userId,
        ip,
      };
      logger.info(`${req.method} ${req.originalUrl}`, logMetadata);

      const finalizePayload = {
        jobId,
        userId,
        httpStatus: res.statusCode,
        durationMs: roundedDurationMs,
        metadata: {
          method: req.method,
          path: req.originalUrl,
          ip,
        },
      };
      safeAsync(
        runReady.then((ready) => {
          if (!ready) return null;
          return success
            ? completeJobRun({
                ...finalizePayload,
                success: true,
              })
            : failJobRun({
                ...finalizePayload,
                errorMessage: `HTTP ${res.statusCode}`,
              });
        }),
        'finalize job run'
      );

      safeAsync(
        runReady.then((ready) => {
          if (!ready) return null;
          return appendJobEvent({
            jobId,
            level: success ? 'info' : 'warn',
            message: 'Request finished',
            userId,
            metadata: {
              status: res.statusCode,
              durationMs: roundedDurationMs,
              success,
            },
          });
        }),
        'append finish event'
      );
    });

    next();
  });
}

module.exports = requestLogger;
