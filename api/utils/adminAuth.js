const crypto = require('crypto');

const ADMIN_AUTH_COOKIE = 'admin_auth';
const ADMIN_CSRF_COOKIE = 'admin_csrf';
const ADMIN_COOKIE_PATH = '/api/admin';
const ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function isProductionEnv() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function getAdminCookieBaseOptions() {
  return {
    path: ADMIN_COOKIE_PATH,
    sameSite: 'strict',
    secure: isProductionEnv(),
    maxAge: ADMIN_SESSION_TTL_MS,
  };
}

function setAdminAuthCookies(res, token, csrfToken = createCsrfToken()) {
  const baseOptions = getAdminCookieBaseOptions();

  res.cookie(ADMIN_AUTH_COOKIE, token, {
    ...baseOptions,
    httpOnly: true,
  });

  res.cookie(ADMIN_CSRF_COOKIE, csrfToken, {
    ...baseOptions,
    httpOnly: false,
  });

  return csrfToken;
}

function clearAdminAuthCookies(res) {
  const baseOptions = getAdminCookieBaseOptions();
  res.clearCookie(ADMIN_AUTH_COOKIE, {
    path: baseOptions.path,
    sameSite: baseOptions.sameSite,
    secure: baseOptions.secure,
    httpOnly: true,
  });
  res.clearCookie(ADMIN_CSRF_COOKIE, {
    path: baseOptions.path,
    sameSite: baseOptions.sameSite,
    secure: baseOptions.secure,
    httpOnly: false,
  });
}

function createCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  ADMIN_AUTH_COOKIE,
  ADMIN_CSRF_COOKIE,
  ADMIN_COOKIE_PATH,
  ADMIN_SESSION_TTL_MS,
  createCsrfToken,
  setAdminAuthCookies,
  clearAdminAuthCookies,
};
