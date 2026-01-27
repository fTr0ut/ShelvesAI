function requireFields(fields) {
  return function (req, res, next) {
    const body = req.body ?? {};
    const missing = fields.filter((f) => body[f] == null || body[f] === '');
    if (missing.length) {
      return res.status(400).json({ error: 'Missing fields', missing });
    }
    next();
  };
}

// UUID v4 regex pattern (also accepts v1-v5)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate that specified parameters are valid UUIDs
 * Checks req.params, req.body, and req.query for each parameter name
 * @param {string|string[]} paramNames - Parameter name(s) to validate
 * @returns {Function} Express middleware
 */
function validateUUID(paramNames) {
  const params = Array.isArray(paramNames) ? paramNames : [paramNames];
  return (req, res, next) => {
    const invalid = [];
    for (const param of params) {
      const value = req.params[param] || req.body[param] || req.query[param];
      if (value && !UUID_REGEX.test(value)) {
        invalid.push(param);
      }
    }
    if (invalid.length) {
      return res.status(400).json({ error: 'Invalid identifier format', invalid });
    }
    next();
  };
}

module.exports = { requireFields, validateUUID };

