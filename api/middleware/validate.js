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

/**
 * Validate that specified params/body fields are valid non-negative integers.
 * Checks req.params first, then req.body for each name.
 * Only validates a field if it is present (absent = pass).
 * @param {string|string[]} paramNames - Parameter name(s) to validate
 * @returns {Function} Express middleware
 */
function validateIntParam(paramNames) {
  const params = Array.isArray(paramNames) ? paramNames : [paramNames];
  return (req, res, next) => {
    const invalid = [];
    for (const param of params) {
      const raw = req.params[param] !== undefined
        ? req.params[param]
        : req.body != null && req.body[param] !== undefined
          ? req.body[param]
          : undefined;
      if (raw === undefined) continue;
      let parsed;

      if (typeof raw === 'number') {
        parsed = raw;
        if (!Number.isInteger(parsed)) {
          invalid.push(param);
          continue;
        }
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!/^\d+$/.test(trimmed)) {
          invalid.push(param);
          continue;
        }
        parsed = parseInt(trimmed, 10);
      } else {
        invalid.push(param);
        continue;
      }

      if (!Number.isFinite(parsed) || parsed < 0) {
        invalid.push(param);
      }
    }
    if (invalid.length) {
      return res.status(400).json({ error: 'Invalid parameter', invalid });
    }
    next();
  };
}

/**
 * Validate that specified string fields do not exceed maximum lengths.
 * Only validates fields that are present in the selected request source.
 * @param {Object} fieldLimits - Map of field name to max character length, e.g. { title: 500 }
 * @param {Object} options - Optional configuration
 * @param {'body'|'query'} options.source - Request source to validate, defaults to 'body'
 * @returns {Function} Express middleware
 */
function validateStringLengths(fieldLimits, options = {}) {
  const source = options.source === 'query' ? 'query' : 'body';
  return (req, res, next) => {
    const payload = req[source] ?? {};
    const exceeded = [];
    for (const [field, maxLen] of Object.entries(fieldLimits)) {
      const value = payload[field];
      if (value == null) continue;
      if (typeof value === 'string') {
        if (value.length > maxLen) {
          exceeded.push({ field, maxLen, actual: value.length });
        }
      } else if (Array.isArray(value)) {
        // Validate each element of an array field (e.g. tags)
        for (let i = 0; i < value.length; i++) {
          const elem = value[i];
          if (typeof elem === 'string' && elem.length > maxLen) {
            exceeded.push({ field: `${field}[${i}]`, maxLen, actual: elem.length });
          }
        }
      }
    }
    if (exceeded.length) {
      return res.status(400).json({ error: 'Input too long', exceeded });
    }
    next();
  };
}

module.exports = { requireFields, validateUUID, validateIntParam, validateStringLengths };

