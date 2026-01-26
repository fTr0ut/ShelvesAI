const adminQueries = require('../database/queries/admin');
const { parsePagination } = require('../database/queries/utils');

/**
 * GET /api/admin/stats
 * Get dashboard statistics
 */
async function getStats(req, res) {
  try {
    const stats = await adminQueries.getSystemStats();
    res.json(stats);
  } catch (err) {
    console.error('Admin getStats error:', err);
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
    console.error('Admin listUsers error:', err);
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
    console.error('Admin getUser error:', err);
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

    const result = await adminQueries.suspendUser(userId, reason, req.user.id);

    if (result.error) {
      const status = result.error === 'User not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }

    res.json({ user: result.user, message: 'User suspended successfully' });
  } catch (err) {
    console.error('Admin suspendUser error:', err);
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

    const result = await adminQueries.unsuspendUser(userId);

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json({ user: result.user, message: 'User unsuspended successfully' });
  } catch (err) {
    console.error('Admin unsuspendUser error:', err);
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

    const result = await adminQueries.toggleAdmin(userId, req.user.id);

    if (result.error) {
      const status = result.error === 'User not found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }

    const message = result.user.isAdmin
      ? 'User granted admin privileges'
      : 'Admin privileges removed';

    res.json({ user: result.user, message });
  } catch (err) {
    console.error('Admin toggleAdmin error:', err);
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
    console.error('Admin getRecentFeed error:', err);
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
    console.error('Admin getSystemInfo error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  getStats,
  listUsers,
  getUser,
  suspendUser,
  unsuspendUser,
  toggleAdmin,
  getRecentFeed,
  getSystemInfo,
};
