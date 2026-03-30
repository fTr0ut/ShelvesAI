const jwt = require('jsonwebtoken');
const adminQueries = require('../database/queries/admin');
const { parsePagination } = require('../database/queries/utils');
const { clearAdminAuthCookies, ADMIN_AUTH_COOKIE } = require('../utils/adminAuth');
const systemSettingsQueries = require('../database/queries/systemSettings');
const jobRunsQueries = require('../database/queries/jobRuns');
const workflowQueueJobsQueries = require('../database/queries/workflowQueueJobs');
const { getSystemSettingsCache } = require('../services/config/SystemSettingsCache');
const { revokeToken, invalidateAuthCache } = require('../middleware/auth');
const visionQuotaQueries = require('../database/queries/visionQuota');
const adminContentQueries = require('../database/queries/adminContent');
const processingStatus = require('../services/processingStatus');
const logger = require('../logger');

const normalizeIp = (ip) => {
  if (!ip || typeof ip !== 'string') return ip;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
};

const getClientIp = (req) => {
  // Only trust proxy headers when Express confirms the request came through
  // a trusted proxy (req.app.get('trust proxy')). Without this, any client
  // can spoof cf-connecting-ip / x-forwarded-for to forge audit log entries.
  const behindProxy = req.ip !== req.socket?.remoteAddress;

  if (behindProxy) {
    const cfConnectingIp = req.headers['cf-connecting-ip'];
    if (typeof cfConnectingIp === 'string' && cfConnectingIp.length > 0) {
      return normalizeIp(cfConnectingIp.trim());
    }
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      return normalizeIp(forwardedFor.split(',')[0].trim());
    }
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.length > 0) {
      return normalizeIp(realIp.trim());
    }
  }

  return normalizeIp(req.socket?.remoteAddress || req.ip);
};

function getAdminContext(req) {
  return {
    ipAddress: getClientIp(req) || null,
    userAgent: req.get('user-agent') || null,
  };
}

function toNumericOrNull(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function hydrateWorkfeedProgress(job) {
  if (!job || !job.jobId) return job;
  const snapshot = processingStatus.getJob(job.jobId);

  const queuePositionNumeric = toNumericOrNull(job.queuePosition);
  const queuedMsNumeric = toNumericOrNull(job.queuedMs);
  const attemptsNumeric = toNumericOrNull(job.attemptCount);
  const maxAttemptsNumeric = toNumericOrNull(job.maxAttempts);

  return {
    ...job,
    queuePosition: queuePositionNumeric == null ? null : queuePositionNumeric,
    queuedMs: queuedMsNumeric == null ? null : queuedMsNumeric,
    attemptCount: attemptsNumeric == null ? 0 : attemptsNumeric,
    maxAttempts: maxAttemptsNumeric == null ? null : maxAttemptsNumeric,
    step: snapshot?.step || null,
    progress: toNumericOrNull(snapshot?.progress),
    message: snapshot?.message || null,
  };
}

/**
 * GET /api/admin/me
 * Get current admin session user
 */
async function getMe(req, res) {
  try {
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        isAdmin: !!req.user.isAdmin,
      },
    });
  } catch (err) {
    logger.error('Admin getMe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * POST /api/admin/logout
 * Clear admin auth cookies
 */
async function logout(req, res) {
  try {
    // Revoke the current JWT so it can't be reused even if captured
    const token = req.cookies?.[ADMIN_AUTH_COOKIE];
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        if (payload.jti && payload.exp) {
          revokeToken(payload.jti, payload.exp);
        }
      } catch (_) {
        // Token already expired or invalid — nothing to revoke
      }
    }
    clearAdminAuthCookies(res);
    res.status(204).send();
  } catch (err) {
    logger.error('Admin logout error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/stats
 * Get dashboard statistics
 */
async function getStats(req, res) {
  try {
    const stats = await adminQueries.getSystemStats();
    res.json(stats);
  } catch (err) {
    logger.error('Admin getStats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/users
 * List users with search and filtering
 */
async function listUsers(req, res) {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const {
      search,
      sortBy,
      sortOrder,
      suspended,
      admin,
      premium,
    } = req.query;

    const result = await adminQueries.listUsers({
      limit,
      offset,
      search: search || null,
      sortBy: sortBy || 'created_at',
      sortOrder: sortOrder || 'desc',
      filterSuspended: suspended === 'true' ? true : suspended === 'false' ? false : null,
      filterAdmin: admin === 'true' ? true : admin === 'false' ? false : null,
      filterPremium: premium === 'true' ? true : premium === 'false' ? false : null,
    });

    res.json({
      users: result.users,
      pagination: {
        limit,
        offset,
        total: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (err) {
    logger.error('Admin listUsers error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/users/:userId
 * Get detailed user info
 */
async function getUser(req, res) {
  try {
    const { userId } = req.params;

    const user = await adminQueries.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (err) {
    logger.error('Admin getUser error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * POST /api/admin/users/:userId/suspend
 * Suspend a user
 */
async function suspendUser(req, res) {
  try {
    const { userId } = req.params;
    const { reason } = req.body || {};

    const result = await adminQueries.suspendUser(
      userId,
      reason,
      req.user.id,
      getAdminContext(req)
    );

    if (result.error) {
      const status = result.error === 'User not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }

    // Flush auth cache so the suspension takes effect immediately
    invalidateAuthCache(userId);

    res.json({ user: result.user, message: 'User suspended successfully' });
  } catch (err) {
    logger.error('Admin suspendUser error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * POST /api/admin/users/:userId/unsuspend
 * Remove suspension from a user
 */
async function unsuspendUser(req, res) {
  try {
    const { userId } = req.params;

    const result = await adminQueries.unsuspendUser(
      userId,
      req.user.id,
      getAdminContext(req)
    );

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    invalidateAuthCache(userId);

    res.json({ user: result.user, message: 'User unsuspended successfully' });
  } catch (err) {
    logger.error('Admin unsuspendUser error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * POST /api/admin/users/:userId/toggle-admin
 * Toggle admin status for a user
 */
async function toggleAdmin(req, res) {
  try {
    const { userId } = req.params;

    const result = await adminQueries.toggleAdmin(
      userId,
      req.user.id,
      getAdminContext(req)
    );

    if (result.error) {
      const status = result.error === 'User not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }

    invalidateAuthCache(userId);

    const message = result.user.isAdmin
      ? 'User granted admin privileges'
      : 'Admin privileges removed';

    res.json({ user: result.user, message });
  } catch (err) {
    logger.error('Admin toggleAdmin error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/feed/recent
 * Get recent activity for monitoring
 */
async function getRecentFeed(req, res) {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

    const activity = await adminQueries.getRecentActivity({ limit, offset });

    res.json({ activity });
  } catch (err) {
    logger.error('Admin getRecentFeed error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/jobs
 * List recent job runs for quick lookup
 */
async function listJobs(req, res) {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const result = await jobRunsQueries.listJobRuns({
      limit,
      offset,
      status: req.query.status || null,
      jobType: req.query.jobType || null,
      userId: req.query.userId || null,
      jobId: req.query.jobId || null,
    });

    res.json({
      jobs: result.jobs,
      pagination: {
        limit,
        offset,
        total: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (err) {
    logger.error('Admin listJobs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/workfeed
 * List workflow queue jobs for live admin monitoring
 */
async function listWorkfeed(req, res) {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

    const shelfIdRaw = req.query.shelfId;
    let shelfId = null;
    if (shelfIdRaw !== undefined && shelfIdRaw !== null && shelfIdRaw !== '') {
      const parsedShelfId = Number.parseInt(String(shelfIdRaw), 10);
      if (!Number.isInteger(parsedShelfId) || parsedShelfId <= 0) {
        return res.status(400).json({ error: 'Invalid shelfId' });
      }
      shelfId = parsedShelfId;
    }

    const jobId = req.query.jobId ? String(req.query.jobId).trim() : null;
    if (jobId && jobId.length > 255) {
      return res.status(400).json({ error: 'Invalid jobId' });
    }

    const result = await workflowQueueJobsQueries.listAdminWorkfeed({
      limit,
      offset,
      status: req.query.status || null,
      workflowType: req.query.workflowType || null,
      userId: req.query.userId || null,
      shelfId,
      jobId,
    });

    const jobs = result.jobs.map(hydrateWorkfeedProgress);

    res.json({
      jobs,
      pagination: {
        limit,
        offset,
        total: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (err) {
    logger.error('Admin listWorkfeed error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/workfeed/:jobId
 * Get workflow queue job detail for admin monitoring
 */
async function getWorkfeedJob(req, res) {
  try {
    const { jobId } = req.params;
    if (!jobId || String(jobId).length > 255) {
      return res.status(400).json({ error: 'Invalid jobId' });
    }

    const job = await workflowQueueJobsQueries.getAdminWorkfeedJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ job: hydrateWorkfeedProgress(job) });
  } catch (err) {
    logger.error('Admin getWorkfeedJob error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/jobs/:jobId
 * Get a job run and its recent event trail
 */
async function getJob(req, res) {
  try {
    const { jobId } = req.params;
    if (!jobId || String(jobId).length > 255) {
      return res.status(400).json({ error: 'Invalid jobId' });
    }

    const job = await jobRunsQueries.getJobRun(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const eventLimitRaw = Number.parseInt(req.query.eventLimit, 10);
    const MAX_EVENT_LIMIT = 1000;
    const eventLimit = Number.isFinite(eventLimitRaw) ? Math.min(eventLimitRaw, MAX_EVENT_LIMIT) : 200;
    const events = await jobRunsQueries.getJobEvents(jobId, { limit: eventLimit });

    res.json({ job, events });
  } catch (err) {
    logger.error('Admin getJob error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/system
 * Get system health info
 */
async function getSystemInfo(req, res) {
  try {
    const uptimeSeconds = process.uptime();
    const memoryUsage = process.memoryUsage();

    res.json({
      uptime: Math.floor(uptimeSeconds),
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
      },
      nodeVersion: process.version,
      platform: process.platform,
    });
  } catch (err) {
    logger.error('Admin getSystemInfo error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/settings
 * List all system settings
 */
async function getSettings(req, res) {
  try {
    const settings = await systemSettingsQueries.getAllSettings();
    res.json({ settings });
  } catch (err) {
    logger.error('Admin getSettings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/settings/:key
 * Get a specific system setting by key
 */
async function getSetting(req, res) {
  try {
    const { key } = req.params;
    const setting = await systemSettingsQueries.getSetting(key);
    if (!setting) {
      return res.status(404).json({ error: 'Setting not found' });
    }
    res.json({ setting });
  } catch (err) {
    logger.error('Admin getSetting error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * PUT /api/admin/settings/:key
 * Create or update a system setting, invalidate cache, and log the action
 */
// Setting keys must be lowercase alphanumeric with underscores, 1–100 chars
const VALID_SETTING_KEY = /^[a-z][a-z0-9_]{0,99}$/;

async function updateSetting(req, res) {
  try {
    const { key } = req.params;
    const { value, description } = req.body || {};

    if (!VALID_SETTING_KEY.test(key)) {
      return res.status(400).json({ error: 'Invalid setting key. Use lowercase alphanumeric with underscores.' });
    }

    if (value === undefined) {
      return res.status(400).json({ error: 'value is required' });
    }

    // Capture previous value for audit log before writing
    const existing = await systemSettingsQueries.getSetting(key);

    const setting = await systemSettingsQueries.upsertSetting(key, value, {
      description: description ?? existing?.description ?? null,
      updatedBy: req.user.id,
    });

    // Invalidate cache after successful DB write
    getSystemSettingsCache().invalidate(key);

    // Audit log
    await adminQueries.logAction({
      adminId: req.user.id,
      action: 'update_setting',
      targetUserId: null,
      metadata: { key, previousValue: existing?.value ?? null },
      ...getAdminContext(req),
    });

    res.json({ setting });
  } catch (err) {
    logger.error('Admin updateSetting error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * POST /api/admin/users/:userId/toggle-premium
 * Toggle premium status for a user (locks by admin)
 */
async function togglePremium(req, res) {
  try {
    const { userId } = req.params;

    const result = await adminQueries.togglePremium(
      userId,
      req.user.id,
      getAdminContext(req)
    );

    if (result.error) {
      const status = result.error === 'User not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }

    invalidateAuthCache(userId);

    const message = result.user.isPremium
      ? 'User granted premium status'
      : 'Premium status removed';

    res.json({ user: result.user, message });
  } catch (err) {
    logger.error('Admin togglePremium error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/users/:userId/vision-quota
 * Get vision quota for a user
 */
async function getUserVisionQuota(req, res) {
  try {
    const { userId } = req.params;
    const quota = await visionQuotaQueries.getQuota(userId);
    res.json({ quota });
  } catch (err) {
    logger.error('Admin getUserVisionQuota error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * POST /api/admin/users/:userId/vision-quota/reset
 * Reset vision quota for a user
 */
async function resetUserVisionQuota(req, res) {
  try {
    const { userId } = req.params;
    await visionQuotaQueries.resetQuota(userId);

    await adminQueries.logAction({
      adminId: req.user.id,
      action: 'VISION_QUOTA_RESET',
      targetUserId: userId,
      metadata: {},
      ...getAdminContext(req),
    });

    const quota = await visionQuotaQueries.getQuota(userId);
    res.json({ quota, message: 'Vision quota reset successfully' });
  } catch (err) {
    logger.error('Admin resetUserVisionQuota error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * PUT /api/admin/users/:userId/vision-quota
 * Set vision quota scans_used for a user
 */
async function setUserVisionQuota(req, res) {
  try {
    const { userId } = req.params;
    const { scansUsed } = req.body || {};

    if (scansUsed === undefined || !Number.isFinite(scansUsed) || scansUsed < 0) {
      return res.status(400).json({ error: 'scansUsed must be a non-negative number' });
    }

    await visionQuotaQueries.setQuota(userId, scansUsed);

    await adminQueries.logAction({
      adminId: req.user.id,
      action: 'VISION_QUOTA_SET',
      targetUserId: userId,
      metadata: { scansUsed },
      ...getAdminContext(req),
    });

    const quota = await visionQuotaQueries.getQuota(userId);
    res.json({ quota, message: 'Vision quota updated successfully' });
  } catch (err) {
    logger.error('Admin setUserVisionQuota error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/audit-logs
 * List admin action logs with filtering
 */
async function listAuditLogs(req, res) {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const result = await adminQueries.listAuditLogs({
      limit,
      offset,
      action: req.query.action || null,
      adminId: req.query.adminId || null,
      targetUserId: req.query.targetUserId || null,
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
    });

    res.json({
      logs: result.logs,
      pagination: {
        limit,
        offset,
        total: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (err) {
    logger.error('Admin listAuditLogs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/stats/detailed
 * Get detailed statistics with breakdowns
 */
async function getDetailedStats(req, res) {
  try {
    const stats = await adminQueries.getDetailedStats();
    res.json(stats);
  } catch (err) {
    logger.error('Admin getDetailedStats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/shelves
 * List shelves for content browsing
 */
async function listShelves(req, res) {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const result = await adminContentQueries.listShelves({
      limit,
      offset,
      type: req.query.type || null,
      userId: req.query.userId || null,
      search: req.query.search || null,
    });

    res.json({
      shelves: result.shelves,
      pagination: {
        limit,
        offset,
        total: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (err) {
    logger.error('Admin listShelves error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/shelves/:shelfId
 * Get shelf details
 */
async function getShelf(req, res) {
  try {
    const { shelfId } = req.params;
    const shelf = await adminContentQueries.getShelfById(shelfId);
    if (!shelf) {
      return res.status(404).json({ error: 'Shelf not found' });
    }
    res.json({ shelf });
  } catch (err) {
    logger.error('Admin getShelf error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/shelves/:shelfId/items
 * Get items on a shelf
 */
async function getShelfItems(req, res) {
  try {
    const { shelfId } = req.params;
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const result = await adminContentQueries.getShelfItems(shelfId, { limit, offset });

    res.json({
      items: result.items,
      pagination: {
        limit,
        offset,
        total: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (err) {
    logger.error('Admin getShelfItems error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/feed/social
 * Get social feed with like/comment counts for admin monitoring
 */
async function getAdminSocialFeed(req, res) {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });
    const eventType = req.query.eventType || null;

    const result = await adminQueries.getAdminSocialFeed({ limit, offset, eventType });

    res.json({
      events: result.events,
      pagination: {
        limit,
        offset,
        total: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (err) {
    logger.error('Admin getAdminSocialFeed error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * GET /api/admin/feed/events/:eventId/comments
 * Get comments for a specific event aggregate
 */
async function getAdminEventComments(req, res) {
  try {
    const { eventId } = req.params;
    if (!UUID_RE.test(eventId)) {
      return res.status(400).json({ error: 'Invalid event ID' });
    }

    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const result = await adminQueries.getAdminEventComments(eventId, { limit, offset });

    res.json(result);
  } catch (err) {
    logger.error('Admin getAdminEventComments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * DELETE /api/admin/feed/events/:eventId
 * Delete an event aggregate (moderation)
 */
async function deleteEvent(req, res) {
  try {
    const { eventId } = req.params;
    if (!UUID_RE.test(eventId)) {
      return res.status(400).json({ error: 'Invalid event ID' });
    }

    const result = await adminQueries.deleteEventAggregate(
      eventId,
      req.user.id,
      getAdminContext(req)
    );

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json({ message: 'Event deleted successfully' });
  } catch (err) {
    logger.error('Admin deleteEvent error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  getMe,
  logout,
  getStats,
  getDetailedStats,
  listUsers,
  getUser,
  suspendUser,
  unsuspendUser,
  toggleAdmin,
  togglePremium,
  getUserVisionQuota,
  resetUserVisionQuota,
  setUserVisionQuota,
  getRecentFeed,
  getAdminSocialFeed,
  getAdminEventComments,
  deleteEvent,
  listWorkfeed,
  getWorkfeedJob,
  listJobs,
  getJob,
  getSystemInfo,
  getSettings,
  getSetting,
  updateSetting,
  listAuditLogs,
  listShelves,
  getShelf,
  getShelfItems,
};
