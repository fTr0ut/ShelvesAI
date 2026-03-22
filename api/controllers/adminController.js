const adminQueries = require('../database/queries/admin');
const { parsePagination } = require('../database/queries/utils');
const { clearAdminAuthCookies } = require('../utils/adminAuth');
const systemSettingsQueries = require('../database/queries/systemSettings');
const jobRunsQueries = require('../database/queries/jobRuns');
const { getSystemSettingsCache } = require('../services/config/SystemSettingsCache');
const logger = require('../logger');

const normalizeIp = (ip) => {
  if (!ip || typeof ip !== 'string') return ip;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
};

const getClientIp = (req) => {
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
  return normalizeIp(req.socket?.remoteAddress || req.ip);
};

function getAdminContext(req) {
  return {
    ipAddress: getClientIp(req) || null,
    userAgent: req.get('user-agent') || null,
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
    } = req.query;

    const result = await adminQueries.listUsers({
      limit,
      offset,
      search: search || null,
      sortBy: sortBy || 'created_at',
      sortOrder: sortOrder || 'desc',
      filterSuspended: suspended === 'true' ? true : suspended === 'false' ? false : null,
      filterAdmin: admin === 'true' ? true : admin === 'false' ? false : null,
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
    const eventLimit = Number.isFinite(eventLimitRaw) ? eventLimitRaw : 200;
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
async function updateSetting(req, res) {
  try {
    const { key } = req.params;
    const { value, description } = req.body || {};

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

module.exports = {
  getMe,
  logout,
  getStats,
  listUsers,
  getUser,
  suspendUser,
  unsuspendUser,
  toggleAdmin,
  getRecentFeed,
  listJobs,
  getJob,
  getSystemInfo,
  getSettings,
  getSetting,
  updateSetting,
};
