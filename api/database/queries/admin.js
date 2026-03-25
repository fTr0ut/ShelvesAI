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
  filterPremium = null,
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

  if (filterPremium !== null) {
    whereConditions.push(`is_premium = $${paramIndex}`);
    params.push(filterPremium);
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
            is_premium, premium_locked_by_admin,
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
  if (userId === adminId) {
    return { error: 'Cannot suspend yourself' };
  }

  return transaction(async (client) => {
    // Block suspending other admins — revoke their admin status first
    const check = await client.query(
      'SELECT is_admin FROM users WHERE id = $1',
      [userId]
    );
    if (check.rows.length && check.rows[0].is_admin) {
      return { error: 'Cannot suspend an admin. Remove admin privileges first.' };
    }

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
    // Read current state inside the transaction to prevent race conditions
    const current = await client.query(
      'SELECT id, username, is_admin FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (current.rows.length === 0) {
      return { error: 'User not found' };
    }

    const targetValue = !current.rows[0].is_admin;
    const result = await client.query(
      `UPDATE users
       SET is_admin = $2
       WHERE id = $1 AND is_admin = $3
       RETURNING id, username, is_admin`,
      [userId, targetValue, current.rows[0].is_admin]
    );

    if (result.rows.length === 0) {
      return { error: 'Concurrent modification detected, please retry' };
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

/**
 * Toggle premium status for a user (admin-only).
 * Sets premium_locked_by_admin = true so the user cannot self-toggle.
 */
async function togglePremium(userId, adminId, context = {}) {
  return transaction(async (client) => {
    const current = await client.query(
      'SELECT id, username, is_premium, premium_locked_by_admin FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (current.rows.length === 0) {
      return { error: 'User not found' };
    }

    const targetValue = !current.rows[0].is_premium;
    const result = await client.query(
      `UPDATE users
       SET is_premium = $2, premium_locked_by_admin = true
       WHERE id = $1 AND is_premium = $3
       RETURNING id, username, is_premium, premium_locked_by_admin`,
      [userId, targetValue, current.rows[0].is_premium]
    );

    if (result.rows.length === 0) {
      return { error: 'Concurrent modification detected, please retry' };
    }

    const updated = result.rows[0];
    await logAdminAction(client, {
      adminId,
      action: 'PREMIUM_TOGGLED',
      targetUserId: userId,
      metadata: { isPremium: !!updated.is_premium, locked: true },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { user: rowToCamelCase(updated) };
  });
}

/**
 * List admin action logs with filtering and pagination
 */
async function listAuditLogs({
  limit = 50,
  offset = 0,
  action = null,
  adminId = null,
  targetUserId = null,
  startDate = null,
  endDate = null,
}) {
  let whereConditions = [];
  let params = [];
  let paramIndex = 1;

  if (action) {
    whereConditions.push(`a.action = $${paramIndex}`);
    params.push(action);
    paramIndex++;
  }

  if (adminId) {
    whereConditions.push(`a.admin_id = $${paramIndex}`);
    params.push(adminId);
    paramIndex++;
  }

  if (targetUserId) {
    whereConditions.push(`a.target_user_id = $${paramIndex}`);
    params.push(targetUserId);
    paramIndex++;
  }

  if (startDate) {
    whereConditions.push(`a.created_at >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    whereConditions.push(`a.created_at <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  const countResult = await query(
    `SELECT COUNT(*) as count FROM admin_action_logs a ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  params.push(limit, offset);
  const result = await query(
    `SELECT a.id, a.admin_id, a.action, a.target_user_id,
            a.metadata, a.ip_address, a.user_agent, a.created_at,
            admin_u.username as admin_username,
            target_u.username as target_username
     FROM admin_action_logs a
     LEFT JOIN users admin_u ON admin_u.id = a.admin_id
     LEFT JOIN users target_u ON target_u.id = a.target_user_id
     ${whereClause}
     ORDER BY a.created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return {
    logs: result.rows.map(rowToCamelCase),
    total,
    hasMore: offset + result.rows.length < total,
  };
}

/**
 * Get detailed statistics with breakdowns for analytics
 */
async function getDetailedStats() {
  const [
    usersByMonth,
    shelvesByType,
    collectablesByKind,
    premiumResult,
    visionResult,
  ] = await Promise.all([
    query(`
      SELECT date_trunc('month', created_at) as month, COUNT(*) as count
      FROM users
      WHERE created_at > NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('month', created_at)
      ORDER BY month ASC
    `),
    query(`
      SELECT type, COUNT(*) as count
      FROM shelves
      GROUP BY type
      ORDER BY count DESC
    `),
    query(`
      SELECT kind, COUNT(*) as count
      FROM collectables
      GROUP BY kind
      ORDER BY count DESC
    `),
    query('SELECT COUNT(*) as count FROM users WHERE is_premium = true'),
    query(`
      SELECT COALESCE(SUM(scans_used), 0) as total_scans,
             COUNT(*) FILTER (WHERE scans_used > 0) as active_users
      FROM user_vision_quota
    `),
  ]);

  return {
    usersByMonth: usersByMonth.rows.map(r => ({ month: r.month, count: parseInt(r.count) })),
    shelvesByType: shelvesByType.rows.map(r => ({ type: r.type, count: parseInt(r.count) })),
    collectablesByKind: collectablesByKind.rows.map(r => ({ kind: r.kind, count: parseInt(r.count) })),
    premiumUsers: parseInt(premiumResult.rows[0].count),
    visionUsage: {
      totalScans: parseInt(visionResult.rows[0].total_scans),
      activeUsers: parseInt(visionResult.rows[0].active_users),
    },
  };
}

/**
 * Log an admin action without a transaction (standalone insert).
 * Use this when the action itself is not part of a larger transaction.
 */
async function logAction({
  adminId,
  action,
  targetUserId = null,
  metadata = {},
  ipAddress = null,
  userAgent = null,
}) {
  const safeMetadata = metadata && typeof metadata === 'object' ? metadata : {};
  await query(
    `INSERT INTO admin_action_logs (admin_id, action, target_user_id, metadata, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [adminId, action, targetUserId, JSON.stringify(safeMetadata), ipAddress, userAgent]
  );
}

/**
 * Get social feed for admin dashboard (all events, no visibility filtering)
 */
async function getAdminSocialFeed({ limit = 30, offset = 0, eventType = null }) {
  const conditions = [];
  const params = [];

  if (eventType) {
    params.push(eventType);
    conditions.push(`a.event_type = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM event_aggregates a ${whereClause}`,
    params
  );
  const total = countResult.rows[0]?.total || 0;

  const dataParams = [...params];
  dataParams.push(limit);
  const limitIdx = dataParams.length;
  dataParams.push(offset);
  const offsetIdx = dataParams.length;

  const result = await query(
    `SELECT a.*,
            u.username, u.picture AS user_picture, u.is_suspended AS user_suspended,
            s.name AS shelf_name, s.type AS shelf_type,
            c.title AS collectable_title, c.primary_creator AS collectable_creator,
            c.cover_url AS collectable_cover_url, c.kind AS collectable_kind,
            um.name AS manual_name, um.author AS manual_author, um.type AS manual_type,
            COALESCE(lc.like_count, 0) AS like_count,
            COALESCE(cc.comment_count, 0) AS comment_count
     FROM event_aggregates a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN shelves s ON s.id = a.shelf_id
     LEFT JOIN collectables c ON c.id = a.collectable_id
     LEFT JOIN user_manuals um ON um.id = a.manual_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS like_count FROM event_likes WHERE event_id = a.id
     ) lc ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS comment_count FROM event_comments WHERE event_id = a.id
     ) cc ON true
     ${whereClause}
     ORDER BY a.last_activity_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams
  );

  return {
    events: result.rows.map(rowToCamelCase),
    total,
    hasMore: offset + limit < total,
  };
}

/**
 * Get comments for an event aggregate (admin view)
 */
async function getAdminEventComments(eventId, { limit = 20, offset = 0 }) {
  const countResult = await query(
    'SELECT COUNT(*)::int AS total FROM event_comments WHERE event_id = $1',
    [eventId]
  );
  const commentCount = countResult.rows[0]?.total || 0;

  const result = await query(
    `SELECT ec.id, ec.content, ec.created_at, ec.user_id,
            u.username, u.picture
     FROM event_comments ec
     LEFT JOIN users u ON u.id = ec.user_id
     WHERE ec.event_id = $1
     ORDER BY ec.created_at DESC
     LIMIT $2 OFFSET $3`,
    [eventId, limit, offset]
  );

  return {
    comments: result.rows.map(rowToCamelCase),
    commentCount,
  };
}

/**
 * Delete an event aggregate (admin moderation).
 * CASCADE deletes likes/comments; event_logs.aggregate_id set to NULL.
 */
async function deleteEventAggregate(eventId, adminId, context = {}) {
  return transaction(async (client) => {
    const existing = await client.query(
      'SELECT id, user_id, event_type, item_count FROM event_aggregates WHERE id = $1 FOR UPDATE',
      [eventId]
    );

    if (existing.rows.length === 0) {
      return { error: 'Event not found' };
    }

    const row = existing.rows[0];

    await client.query('DELETE FROM event_aggregates WHERE id = $1', [eventId]);

    await logAdminAction(client, {
      adminId,
      action: 'EVENT_DELETED',
      targetUserId: row.user_id,
      metadata: {
        eventId,
        eventType: row.event_type,
        itemCount: row.item_count,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { deleted: true };
  });
}

module.exports = {
  getSystemStats,
  listUsers,
  getUserById,
  suspendUser,
  unsuspendUser,
  toggleAdmin,
  togglePremium,
  getRecentActivity,
  listAuditLogs,
  getDetailedStats,
  logAction,
  getAdminSocialFeed,
  getAdminEventComments,
  deleteEventAggregate,
};
