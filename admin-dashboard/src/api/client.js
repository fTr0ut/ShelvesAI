import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const storage = typeof window !== 'undefined' ? window.sessionStorage : null;

const client = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
client.interceptors.request.use(
  (config) => {
    const token = storage?.getItem('adminToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle auth errors
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      storage?.removeItem('adminToken');
      storage?.removeItem('adminUser');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = (username, password) =>
  client.post('/admin/login', { username, password });

// Admin endpoints
export const getStats = () => client.get('/admin/stats');

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

export const getRecentFeed = (params = {}) =>
  client.get('/admin/feed/recent', { params });

export const getSystemInfo = () =>
  client.get('/admin/system');

export default client;
