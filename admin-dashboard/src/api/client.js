import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';
if (import.meta.env.PROD && /^http:\/\//i.test(API_URL)) {
  throw new Error('VITE_API_URL must use HTTPS in production builds');
}

const CSRF_COOKIE_NAME = 'admin_csrf';
const SAFE_METHODS = new Set(['get', 'head', 'options']);

function getCookieValue(name) {
  if (typeof document === 'undefined') return null;
  const encodedName = encodeURIComponent(name);
  const parts = document.cookie ? document.cookie.split('; ') : [];
  for (const part of parts) {
    const [rawKey, ...rest] = part.split('=');
    if (rawKey === encodedName) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

const client = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add CSRF token for state-changing admin requests.
client.interceptors.request.use(
  (config) => {
    const method = String(config.method || 'get').toLowerCase();
    if (!SAFE_METHODS.has(method)) {
      const csrfToken = getCookieValue(CSRF_COOKIE_NAME);
      if (csrfToken) {
        config.headers['X-CSRF-Token'] = csrfToken;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle auth errors
client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const requestUrl = String(error.config?.url || '');
    const isAuthBootstrap = requestUrl.includes('/admin/login') || requestUrl.includes('/admin/me');
    if (status === 401 && !isAuthBootstrap) {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = (username, password) =>
  client.post('/admin/login', { username, password });

export const getMe = () =>
  client.get('/admin/me');

export const logout = () =>
  client.post('/admin/logout');

// Dashboard
export const getStats = () => client.get('/admin/stats');
export const getDetailedStats = () => client.get('/admin/stats/detailed');
export const getSystemInfo = () => client.get('/admin/system');

// Users
export const getUsers = (params = {}) =>
  client.get('/admin/users', { params });

export const getUser = (userId) =>
  client.get(`/admin/users/${userId}`);

export const suspendUser = (userId, reason) =>
  client.post(`/admin/users/${userId}/suspend`, { reason });

export const unsuspendUser = (userId) =>
  client.post(`/admin/users/${userId}/unsuspend`);

export const toggleAdmin = (userId) =>
  client.post(`/admin/users/${userId}/toggle-admin`);

export const togglePremium = (userId) =>
  client.post(`/admin/users/${userId}/toggle-premium`);

// Vision quota
export const getUserVisionQuota = (userId) =>
  client.get(`/admin/users/${userId}/vision-quota`);

export const resetUserVisionQuota = (userId) =>
  client.post(`/admin/users/${userId}/vision-quota/reset`);

export const setUserVisionQuota = (userId, scansUsed) =>
  client.put(`/admin/users/${userId}/vision-quota`, { scansUsed });

// Activity feed
export const getRecentFeed = (params = {}) =>
  client.get('/admin/feed/recent', { params });

// Social feed
export const getAdminSocialFeed = (params = {}) =>
  client.get('/admin/feed/social', { params });

export const getAdminEventComments = (eventId, params = {}) =>
  client.get(`/admin/feed/events/${eventId}/comments`, { params });

export const deleteEvent = (eventId) =>
  client.delete(`/admin/feed/events/${eventId}`);

// Jobs
export const getJobs = (params = {}) =>
  client.get('/admin/jobs', { params });

export const getJob = (jobId) =>
  client.get(`/admin/jobs/${jobId}`);

// Audit logs
export const getAuditLogs = (params = {}) =>
  client.get('/admin/audit-logs', { params });

// System settings
export const getSettings = () =>
  client.get('/admin/settings');

export const updateSetting = (key, value, description) =>
  client.put(`/admin/settings/${key}`, { value, description });

// Content browsing
export const getShelves = (params = {}) =>
  client.get('/admin/shelves', { params });

export const getShelf = (shelfId) =>
  client.get(`/admin/shelves/${shelfId}`);

export const getShelfItems = (shelfId, params = {}) =>
  client.get(`/admin/shelves/${shelfId}/items`, { params });

export default client;
