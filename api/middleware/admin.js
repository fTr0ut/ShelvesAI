/**
 * Admin middleware - requires user to be authenticated with an admin-type
 * JWT and have admin privileges in the database.
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Reject mobile/user JWTs on admin routes — require an admin-session token
  if (req.tokenType !== 'admin') {
    return res.status(403).json({ error: 'Admin session required. Please log in via the admin dashboard.' });
  }

  next();
}

module.exports = { requireAdmin };
