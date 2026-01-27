const { query } = require('../database/pg');
const { rowToCamelCase, buildUpdateQuery } = require('../database/queries/utils');
const visionQuotaQueries = require('../database/queries/visionQuota');
const { addMediaUrls } = require('../services/mediaUrl');

async function getAccount(req, res) {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.phone_number,
              u.picture, u.country, u.city, u.state, u.is_private, u.is_premium,
              u.onboarding_completed, u.created_at,
              pm.local_path as profile_media_path
       FROM users u
       LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = addMediaUrls(rowToCamelCase(result.rows[0]));

    // Get vision quota info
    let visionQuota = null;
    try {
      visionQuota = await visionQuotaQueries.getQuota(req.user.id);
    } catch (quotaErr) {
      console.warn('Failed to get vision quota:', quotaErr.message);
    }

    res.json({ user, visionQuota });
  } catch (err) {
    console.error('getAccount error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateAccount(req, res) {
  try {
    const allowedFields = [
      'first_name', 'last_name', 'phone_number',
      'country', 'city', 'state', 'is_private', 'is_premium', 'picture'
    ];

    const updateQuery = buildUpdateQuery(
      'users',
      req.body || {},
      'id',
      req.user.id,
      allowedFields
    );

    if (!updateQuery) {
      // No valid updates, just return current user
      return getAccount(req, res);
    }

    const result = await query(updateQuery.text, updateQuery.values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rowToCamelCase(result.rows[0]);
    res.json({ user });
  } catch (err) {
    console.error('updateAccount error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getAccount, updateAccount };
