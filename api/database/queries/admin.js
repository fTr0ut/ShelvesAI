const { query, transaction } = require('../pg');
const { rowToCamelCase } = require('./utils');

async function logAdminAction(client, {
  adminId,
  action,
  targetUserId = null,
  metadata = {},
  ipAddress = null,
  userAgent = null,
}) {
  const safeMetadata = metadata && typeof metadata === 'object' ? metadata : {};
  await client.query(
    `INSERT INTO admin_action_logs (admin_id, action, target_user_id, metadata, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [adminId, action, targetUserId, JSON.stringify(safeMetadata), ipAddress, userAgent]
  );
}

/**
 * Get system-wide statistics for admin dashboard
 */
async function getSystemStats() {
  const [
    usersResult,
    shelvesResult,
    collectionsResult,
    suspendedResult,
    adminsResult,
    recentUsersResult,
  ] = await Promise.all([
    query('SELECT COUNT(*) as count FROM users'),
    query('SELECT COUNT(*) as count FROM shelves'),
    query('SELECT COUNT(*) as count FROM user_collections'),
    query('SELECT COUNT(*) as count FROM users WHERE is_suspended = true'),
    query('SELECT COUNT(*) as count FROM users WHERE is_admin = true'),
    query(`SELECT COUNT(*) as count FROM users WHERE created_at > NOW() - INTERVAL '7 days'`),
  ]);

  return {
    totalUsers: parseInt(usersResult.rows[0].count),
    totalShelves: parseInt(shelvesResult.rows[0].count),
    totalCollections: parseInt(collectionsResult.rows[0].count),
    suspendedUsers: parseInt(suspendedResult.rows[0].count),
    adminUsers: parseInt(adminsResult.rows[0].count),
    newUsersLast7Days: parseInt(recentUsersResult.rows[0].count),
  };
}

/**
 * List users with pagination, search, and filtering
 */
async function listUsers({
  limit = 20,
  offset = 0,
  search = null,
  sortBy = 'created_at',
  sortOrder = 'desc',
  filterSuspended = null,
  filterAdmin = null,
}) {
  const allowedSorts = ['created_at', 'username', 'email'];
  const sortColumn = allowedSorts.includes(sortBy) ? sortBy : 'created_at';
  const order = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  let whereConditions = [];
  let params = [];
  let paramIndex = 1;

  if (search) {
    whereConditions.push(`(
      username ILIKE $${paramIndex}
      OR email ILIKE $${paramIndex}
      OR first_name ILIKE $${paramIndex}
      OR last_name ILIKE $${paramIndex}
    )`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (filterSuspended !== null) {
    whereConditions.push(`is_suspended = $${paramIndex}`);
    params.push(filterSuspended);
    paramIndex++;
  }

  if (filterAdmin !== null) {
    whereConditions.push(`is_admin = $${paramIndex}`);
    params.push(filterAdmin);
    paramIndex++;
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  const countResult = await query(
    `SELECT COUNT(*) as count FROM users ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  params.push(limit, offset);
  const result = await query(
    `SELECT id, username, email, first_name, last_name, picture,
            is_admin, is_suspended, suspended_at, suspension_reason,
            created_at, updated_at
     FROM users
     ${whereClause}
     ORDER BY ${sortColumn} ${order}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return {
    users: result.rows.map(rowToCamelCase),
    total,
    hasMore: offset + result.rows.length < total,
  };
}

/**
 * Get detailed user info by ID
 */
async function getUserById(userId) {
  const result = await query(
    `SELECT u.id, u.username, u.email, u.first_name, u.last_name,
            u.picture, u.bio, u.city, u.state, u.country,
            u.is_admin, u.is_suspended, u.suspended_at, u.suspension_reason,
            u.is_private, u.is_premium, u.onboarding_completed,
            u.created_at, u.updated_at,
            (SELECT COUNT(*) FROM shelves WHERE owner_id = u.id) as shelf_count,
            (SELECT COUNT(*) FROM user_collections WHERE user_id = u.id) as collection_count,
            (SELECT COUNT(*) FROM friendships WHERE (requester_id = u.id OR addressee_id = u.id) AND status = 'accepted') as friend_count
     FROM users u
     WHERE u.id = $1`,
    [userId]
  );

  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

/**
 * Suspend a user
 */
async function suspendUser(userId, reason = null, adminId, context = {}) {
  // Prevent admin from suspending themselves
  if (userId === adminId) {
    return { error: 'Cannot suspend yourself' };
  }

  return transaction(async (client) => {
    const result = await client.query(
      `UPDATE users
       SET is_suspended = true,
           suspended_at = NOW(),
           suspension_reason = $2
       WHERE id = $1
       RETURNING id, username, is_suspended, suspended_at, suspension_reason`,
      [userId, reason]
    );

    if (result.rows.length === 0) {
      return { error: 'User not found' };
    }

    await logAdminAction(client, {
      adminId,
      action: 'USER_SUSPENDED',
      targetUserId: userId,
      metadata: { reason: reason || null },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { user: rowToCamelCase(result.rows[0]) };
  });
}

/**
 * Unsuspend a user
 */
async function unsuspendUser(userId, adminId, context = {}) {
  return transaction(async (client) => {
    const result = await client.query(
      `UPDATE users
       SET is_suspended = false,
           suspended_at = NULL,
           suspension_reason = NULL
       WHERE id = $1
       RETURNING id, username, is_suspended`,
      [userId]
    );

    if (result.rows.length === 0) {
      return { error: 'User not found' };
    }

    await logAdminAction(client, {
      adminId,
      action: 'USER_UNSUSPENDED',
      targetUserId: userId,
      metadata: {},
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { user: rowToCamelCase(result.rows[0]) };
  });
}

/**
 * Toggle admin status for a user
 */
async function toggleAdmin(userId, adminId, context = {}) {
  // Prevent admin from removing their own admin status
  if (userId === adminId) {
    return { error: 'Cannot modify your own admin status' };
  }

  return transaction(async (client) => {
    const result = await client.query(
      `UPDATE users
       SET is_admin = NOT is_admin
       WHERE id = $1
       RETURNING id, username, is_admin`,
      [userId]
    );

    if (result.rows.length === 0) {
      return { error: 'User not found' };
    }

    const updated = result.rows[0];
    await logAdminAction(client, {
      adminId,
      action: updated.is_admin ? 'ADMIN_GRANTED' : 'ADMIN_REVOKED',
      targetUserId: userId,
      metadata: { isAdmin: !!updated.is_admin },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { user: rowToCamelCase(updated) };
  });
}

/**
 * Get recent feed activity for admin monitoring
 */
async function getRecentActivity({ limit = 50, offset = 0 }) {
  const result = await query(
    `SELECT a.*,
            u.username, u.picture as user_picture,
            s.name as shelf_name, s.type as shelf_type
     FROM event_aggregates a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN shelves s ON s.id = a.shelf_id
     ORDER BY a.last_activity_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return result.rows.map(rowToCamelCase);
}

module.exports = {
  getSystemStats,
  listUsers,
  getUserById,
  suspendUser,
  unsuspendUser,
  toggleAdmin,
  getRecentActivity,
};
