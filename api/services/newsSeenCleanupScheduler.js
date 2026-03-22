/**
 * Scheduler for cleaning up old user_news_seen records.
 * Runs nightly and on boot to delete records older than 48 hours.
 */
const { deleteOldSeenRecords } = require('../database/queries/newsSeen');
const logger = require('../logger');
const { runJob } = require('../utils/jobRunner');

const DEFAULT_CLEANUP_HOUR = 3;
const DEFAULT_CLEANUP_MINUTE = 0;
const DEFAULT_MAX_AGE_HOURS = 48;

let schedulerStarted = false;
let cleanupInProgress = false;
let scheduledTimeout = null;

function parseNumberInRange(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

function getScheduledTime() {
  const hour = parseNumberInRange(
    process.env.NEWS_SEEN_CLEANUP_HOUR,
    DEFAULT_CLEANUP_HOUR,
    0,
    23
  );
  const minute = parseNumberInRange(
    process.env.NEWS_SEEN_CLEANUP_MINUTE,
    DEFAULT_CLEANUP_MINUTE,
    0,
    59
  );
  return { hour, minute };
}

function getMaxAgeHours() {
  return parseNumberInRange(
    process.env.NEWS_SEEN_MAX_AGE_HOURS,
    DEFAULT_MAX_AGE_HOURS,
    1,
    720
  );
}

function msUntilNextRun({ hour, minute }) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setDate(now.getDate() + 1);
  }
  return {
    delayMs: next.getTime() - now.getTime(),
    nextRun: next,
  };
}

async function runCleanupSafely(reason) {
  if (cleanupInProgress) {
    logger.info(`[News Seen Cleanup] Cleanup already running; skipping (${reason}).`);
    return;
  }
  cleanupInProgress = true;
  try {
    await runJob('newsSeenCleanup', async () => {
      const maxAgeHours = getMaxAgeHours();
      logger.info(`[News Seen Cleanup] Starting cleanup (${reason}), deleting records older than ${maxAgeHours} hours.`);
      const deletedCount = await deleteOldSeenRecords(maxAgeHours);
      logger.info(`[News Seen Cleanup] Completed. Deleted ${deletedCount} old records.`, { deletedCount });
    });
  } finally {
    cleanupInProgress = false;
  }
}

function scheduleNextCleanup() {
  const scheduledTime = getScheduledTime();
  const { delayMs, nextRun } = msUntilNextRun(scheduledTime);

  if (scheduledTimeout) {
    clearTimeout(scheduledTimeout);
  }

  logger.info(`[News Seen Cleanup] Next cleanup scheduled for ${nextRun.toISOString()}.`);

  scheduledTimeout = setTimeout(async () => {
    await runCleanupSafely('scheduled');
    scheduleNextCleanup();
  }, delayMs);

  if (typeof scheduledTimeout.unref === 'function') {
    scheduledTimeout.unref();
  }
}

function startNewsSeenCleanupScheduler({ runOnStartup = true } = {}) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  if (process.env.NEWS_SEEN_CLEANUP_DISABLED === 'true') {
    logger.info('[News Seen Cleanup] Scheduler disabled via NEWS_SEEN_CLEANUP_DISABLED.');
    return;
  }

  if (runOnStartup) {
    runCleanupSafely('startup').catch((err) => {
      logger.warn('[News Seen Cleanup] Startup cleanup failed:', { error: err.message });
    });
  }

  scheduleNextCleanup();
}

module.exports = {
  startNewsSeenCleanupScheduler,
};
