const { query } = require('../database/pg');
const { runRefresh } = require('../jobs/refreshNewsCache');

const DEFAULT_REFRESH_HOUR = 4;
const DEFAULT_REFRESH_MINUTE = 0;

let schedulerStarted = false;
let refreshInProgress = false;
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
    process.env.NEWS_CACHE_REFRESH_HOUR,
    DEFAULT_REFRESH_HOUR,
    0,
    23
  );
  const minute = parseNumberInRange(
    process.env.NEWS_CACHE_REFRESH_MINUTE,
    DEFAULT_REFRESH_MINUTE,
    0,
    59
  );
  return { hour, minute };
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

async function getCacheCounts() {
  try {
    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE expires_at > NOW())::int AS active_count,
        COUNT(*) FILTER (WHERE expires_at <= NOW())::int AS expired_count,
        COUNT(*)::int AS total_count
      FROM news_items
    `);
    return result.rows[0] || { active_count: 0, expired_count: 0, total_count: 0 };
  } catch (err) {
    if (err && err.code === '42P01') {
      console.warn('[News Cache] news_items table missing; skipping cache checks.');
      return null;
    }
    console.warn('[News Cache] Failed to read cache status:', err.message);
    return null;
  }
}

async function runRefreshSafely(reason) {
  if (refreshInProgress) {
    console.log(`[News Cache] Refresh already running; skipping (${reason}).`);
    return;
  }
  refreshInProgress = true;
  try {
    console.log(`[News Cache] Starting refresh (${reason}).`);
    await runRefresh();
  } catch (err) {
    console.error('[News Cache] Refresh failed:', err);
  } finally {
    refreshInProgress = false;
  }
}

async function checkAndRefreshOnBoot() {
  const counts = await getCacheCounts();
  if (!counts) return;

  if (counts.total_count === 0) {
    console.log('[News Cache] Cache empty on boot; refreshing.');
    await runRefreshSafely('startup-empty');
    return;
  }

  if (counts.active_count === 0) {
    console.log('[News Cache] Cache expired on boot; refreshing.');
    await runRefreshSafely('startup-expired');
    return;
  }

  if (counts.expired_count > 0) {
    console.log('[News Cache] Cache has expired items; scheduled refresh will clean up.');
  } else {
    console.log('[News Cache] Cache healthy on boot; no immediate refresh needed.');
  }
}

function scheduleNextRefresh() {
  const scheduledTime = getScheduledTime();
  const { delayMs, nextRun } = msUntilNextRun(scheduledTime);

  if (scheduledTimeout) {
    clearTimeout(scheduledTimeout);
  }

  console.log(`[News Cache] Next refresh scheduled for ${nextRun.toISOString()}.`);

  scheduledTimeout = setTimeout(async () => {
    await runRefreshSafely('scheduled');
    scheduleNextRefresh();
  }, delayMs);

  if (typeof scheduledTimeout.unref === 'function') {
    scheduledTimeout.unref();
  }
}

function startNewsCacheScheduler({ runOnStartup = true } = {}) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  if (process.env.NEWS_CACHE_SCHEDULER_DISABLED === 'true') {
    console.log('[News Cache] Scheduler disabled via NEWS_CACHE_SCHEDULER_DISABLED.');
    return;
  }

  if (runOnStartup) {
    checkAndRefreshOnBoot().catch((err) => {
      console.warn('[News Cache] Startup check failed:', err.message);
    });
  }

  scheduleNextRefresh();
}

module.exports = {
  startNewsCacheScheduler,
};
