const { query } = require('../database/pg');
const { rowToCamelCase, buildUpdateQuery } = require('../database/queries/utils');

async function getAccount(req, res) {
  try {
    const result = await query(
      `SELECT id, username, email, first_name, last_name, phone_number, 
              picture, country, city, state, is_private, is_premium, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rowToCamelCase(result.rows[0]);
    res.json({ user });
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
