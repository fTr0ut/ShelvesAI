/**
 * Processing Status Service
 * 
 * In-memory cache for tracking vision processing job status.
 * Enables progress polling and abort functionality.
 */

// Job status storage: jobId -> { status, step, progress, message, aborted, result, createdAt }
const jobs = new Map();

// Auto-expire jobs after 5 minutes
const JOB_TTL_MS = 5 * 60 * 1000;

/**
 * Create a new job entry
 * @param {string} jobId - Unique job identifier
 * @param {number} userId - User who initiated the job
 * @param {number} shelfId - Target shelf ID
 * @returns {object} Initial job state
 */
function createJob(jobId, userId, shelfId) {
    const job = {
        jobId,
        userId,
        shelfId,
        status: 'pending',
        step: 'initializing',
        progress: 0,
        message: 'Starting vision processing...',
        aborted: false,
        result: null,
        createdAt: Date.now(),
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
function abortJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return false;

    job.aborted = true;
    job.status = 'aborted';
    job.message = 'Processing cancelled by user';
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
    return job;
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
    generateJobId,
};
