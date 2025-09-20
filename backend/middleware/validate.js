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

module.exports = { requireFields };

