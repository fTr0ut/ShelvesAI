'use strict';

const { randomUUID } = require('crypto');
const { store } = require('../context');

function normalizeWorkflowName(name) {
  const raw = typeof name === 'string' ? name.trim().toLowerCase() : '';
  const normalized = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'workflow';
}

/**
 * Attach an AsyncLocalStorage context with a workflow-scoped request jobId.
 * This middleware is intentionally lightweight:
 * - assigns request-level jobId context for logs/helpers
 * - does NOT write request logs/events to DB
 *
 * @param {string} workflowName
 * @returns {import('express').RequestHandler}
 */
function createWorkflowJobContext(workflowName) {
  const workflowKey = normalizeWorkflowName(workflowName);

  return function workflowJobContext(req, res, next) {
    const shortId = randomUUID().replace(/-/g, '').slice(0, 10);
    const jobId = `wf_${workflowKey}_${shortId}`;
    const userId = req.user?.id || null;

    store.run({ jobId, userId }, () => {
      req.jobId = jobId;

      if (typeof res.setHeader === 'function' && !res.headersSent) {
        res.setHeader('x-job-id', jobId);
      }

      next();
    });
  };
}

module.exports = {
  createWorkflowJobContext,
};

