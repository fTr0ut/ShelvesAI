/**
 * Processing Status Service
 * 
 * In-memory cache for tracking vision processing job status.
 * Enables progress polling and abort functionality.
 */

// Job status storage: jobId -> { status, step, progress, message, aborted, result, createdAt }
const jobs = new Map();

// Keep terminal statuses for at least 24h by default; configurable for ops tuning.
const parsedTtl = Number.parseInt(process.env.PROCESSING_STATUS_TTL_MS || '', 10);
const JOB_TTL_MS = Number.isFinite(parsedTtl) && parsedTtl > 0
    ? parsedTtl
    : 24 * 60 * 60 * 1000;

/**
 * Create a new job entry
 * @param {string} jobId - Unique job identifier
 * @param {number} userId - User who initiated the job
 * @param {number} shelfId - Target shelf ID
 * @returns {object} Initial job state
 */
function createJob(jobId, userId, shelfId, options = {}) {
    const job = {
        jobId,
        userId,
        shelfId,
        status: options.status || 'pending',
        step: options.step || 'initializing',
        progress: Number.isFinite(Number(options.progress)) ? Number(options.progress) : 0,
        message: options.message || 'Starting vision processing...',
        aborted: options.aborted === true,
        result: options.result || null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    jobs.set(jobId, job);
    scheduleCleanup(jobId);
    return job;
}

/**
 * Update job status
 * @param {string} jobId 
 * @param {object} updates - { step?, progress?, message?, status?, result? }
 */
function updateJob(jobId, updates) {
    const job = jobs.get(jobId);
    if (!job) return null;

    Object.assign(job, updates);
    job.updatedAt = Date.now();
    return job;
}

/**
 * Get current job status
 * @param {string} jobId 
 * @returns {object|null}
 */
function getJob(jobId) {
    return jobs.get(jobId) || null;
}

/**
 * Mark job as aborted
 * @param {string} jobId 
 * @returns {boolean} True if job was found and marked
 */
function abortJob(jobId, options = {}) {
    const job = jobs.get(jobId);
    if (!job) return false;

    job.aborted = true;
    if (options.preserveStatus !== true) {
        job.status = 'aborted';
        job.message = options.message || 'Processing cancelled by user';
    }
    job.updatedAt = Date.now();
    return true;
}

/**
 * Check if job has been aborted
 * @param {string} jobId 
 * @returns {boolean}
 */
function isAborted(jobId) {
    const job = jobs.get(jobId);
    return job?.aborted === true;
}

/**
 * Mark job as complete
 * @param {string} jobId 
 * @param {object} result - Final processing result
 */
function completeJob(jobId, result) {
    const job = jobs.get(jobId);
    if (!job) return null;

    job.status = 'completed';
    job.progress = 100;
    job.message = 'Processing complete';
    job.result = result;
    job.updatedAt = Date.now();
    return job;
}

/**
 * Mark job as failed
 * @param {string} jobId 
 * @param {string} error - Error message
 */
function failJob(jobId, error) {
    const job = jobs.get(jobId);
    if (!job) return null;

    job.status = 'failed';
    job.message = error || 'Processing failed';
    job.updatedAt = Date.now();
    return job;
}

/**
 * Hydrate/replace an in-memory job snapshot from an external source (DB fallback).
 * @param {string} jobId
 * @param {object} snapshot
 * @returns {object}
 */
function setJob(jobId, snapshot = {}) {
    const existing = jobs.get(jobId) || {};
    const merged = {
        ...existing,
        ...snapshot,
        jobId,
        updatedAt: Date.now(),
    };
    if (!merged.createdAt) {
        merged.createdAt = Date.now();
    }
    jobs.set(jobId, merged);
    scheduleCleanup(jobId);
    return merged;
}

/**
 * Schedule job cleanup after TTL
 */
function scheduleCleanup(jobId) {
    setTimeout(() => {
        jobs.delete(jobId);
    }, JOB_TTL_MS);
}

/**
 * Generate a unique job ID
 * @param {number} userId 
 * @param {number} shelfId 
 * @returns {string}
 */
function generateJobId(userId, shelfId) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `vision-${userId}-${shelfId}-${timestamp}-${random}`;
}

module.exports = {
    createJob,
    updateJob,
    getJob,
    abortJob,
    isAborted,
    completeJob,
    failJob,
    setJob,
    generateJobId,
};
