const { query } = require('../database/pg');
const { rowToCamelCase, buildUpdateQuery } = require('../database/queries/utils');
const visionQuotaQueries = require('../database/queries/visionQuota');
const { addMediaUrls } = require('../services/mediaUrl');
const { sendFeedbackEmail } = require('../services/emailService');
const logger = require('../logger');

async function getAccount(req, res) {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.phone_number,
              u.picture, u.country, u.city, u.state, u.is_private, u.is_premium,
              u.onboarding_completed, u.terms_accepted, u.terms_accepted_version, u.terms_accepted_at,
              u.show_personal_photos, u.created_at,
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
      logger.warn('Failed to get vision quota:', quotaErr.message);
    }

    res.json({ user, visionQuota, unlimitedVisionTokens: req.user.unlimitedVisionTokens || false });
  } catch (err) {
    logger.error('getAccount error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateAccount(req, res) {
  try {
    // Block user from toggling premium when locked by admin
    if (req.body?.is_premium !== undefined && req.user.premiumLockedByAdmin) {
      return res.status(403).json({ error: 'Premium status is managed by an administrator' });
    }

    const allowedFields = [
      'first_name', 'last_name', 'phone_number',
      'country', 'city', 'state', 'is_private', 'is_premium', 'picture',
      'show_personal_photos'
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
    logger.error('updateAccount error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function submitFeedback(req, res) {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Feedback message is required' });
  }

  if (message.length > 4000) {
    return res.status(400).json({ error: 'Feedback message is too long (max 4000 characters)' });
  }

  try {
    const userResult = await query(
      `SELECT id, username, email, first_name, last_name
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    await sendFeedbackEmail({
      message,
      userId: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
    });

    return res.status(201).json({ success: true });
  } catch (err) {
    logger.error('submitFeedback error:', err);
    return res.status(502).json({ error: 'Unable to submit feedback right now' });
  }
}

module.exports = { getAccount, updateAccount, submitFeedback };
