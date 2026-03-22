'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const store = new AsyncLocalStorage();

const getContext = () => store.getStore() || {};
const getJobId = () => getContext().jobId || 'no-job';
const getUserId = () => getContext().userId || null;

function setContextValue(key, value) {
  const context = store.getStore();
  if (!context) return;
  context[key] = value;
}

const setUserId = (userId) => setContextValue('userId', userId);

module.exports = { store, getContext, getJobId, getUserId, setUserId };
