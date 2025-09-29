const { URL, URLSearchParams } = require('url');

function first(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function buildRedirectUrl(clientReturnTo, query = {}) {
  if (!clientReturnTo) {
    const err = new Error('client_return_to is required');
    err.code = 'CLIENT_RETURN_TO_MISSING';
    throw err;
  }

  let target;
  try {
    target = new URL(clientReturnTo);
  } catch (err) {
    const error = new Error('client_return_to must be a valid URL');
    error.code = 'CLIENT_RETURN_TO_INVALID';
    throw error;
  }

  const forward = new URLSearchParams();
  const state = first(query.state || query.link_state || query.linkState);
  if (state) {
    forward.set('state', state);
  }

  Object.entries(query).forEach(([key, value]) => {
    if (!key.startsWith('openid.')) return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null) forward.append(key, String(item));
      });
      return;
    }
    if (value !== undefined && value !== null) {
      forward.append(key, String(value));
    }
  });

  forward.forEach((value, key) => {
    target.searchParams.append(key, value);
  });

  return target.toString();
}

function handleSteamOpenIdReturn(req, res) {
  try {
    const query = req.query || {};
    const clientReturnTo = first(query.client_return_to || query.clientReturnTo);
    const redirectUrl = buildRedirectUrl(clientReturnTo, query);
    res.redirect(302, redirectUrl);
  } catch (err) {
    const status = err.code === 'CLIENT_RETURN_TO_INVALID' ? 400 : 400;
    res.status(status).json({ error: err.message || 'Unable to process Steam OpenID response' });
  }
}

module.exports = {
  buildRedirectUrl,
  handleSteamOpenIdReturn,
};
