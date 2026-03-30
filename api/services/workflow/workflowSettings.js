const { getSystemSettingsCache } = require('../config/SystemSettingsCache');

const DEFAULTS = Object.freeze({
  workflowQueueMaxRunning: 2,
  workflowQueueMaxRunningPerUser: 1,
  workflowQueueMaxQueuedPerUser: 4,
  workflowQueueLongThresholdPosition: 3,
  workflowQueueNotifyMinWaitMs: 20000,
  workflowQueueRetryMaxAttempts: 1,
  workflowQueueTerminalRetentionMs: 24 * 60 * 60 * 1000,
});

function toInt(value, fallback, { min = null, max = null } = {}) {
  const num = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(num)) return fallback;
  let out = num;
  if (Number.isFinite(min)) out = Math.max(min, out);
  if (Number.isFinite(max)) out = Math.min(max, out);
  return out;
}

function readEnvInt(primary, fallback, options = {}) {
  const upper = primary.toUpperCase();
  const candidates = [
    process.env[primary],
    process.env[upper],
  ];
  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue;
    return toInt(candidate, fallback, options);
  }
  return fallback;
}

function parseSystemSettingNumber(value, fallback, options = {}) {
  if (value == null) return fallback;
  if (typeof value === 'number') return toInt(value, fallback, options);
  if (typeof value === 'string') return toInt(value, fallback, options);
  if (typeof value === 'object') {
    if (typeof value.value === 'number' || typeof value.value === 'string') {
      return toInt(value.value, fallback, options);
    }
  }
  return fallback;
}

async function readNumberSetting(key, fallback, options = {}) {
  const envValue = readEnvInt(key, fallback, options);
  try {
    const cached = await getSystemSettingsCache().get(key);
    return parseSystemSettingNumber(cached, envValue, options);
  } catch (_err) {
    return envValue;
  }
}

async function getWorkflowQueueSettings() {
  const [
    workflowQueueMaxRunning,
    workflowQueueMaxRunningPerUser,
    workflowQueueMaxQueuedPerUser,
    workflowQueueLongThresholdPosition,
    workflowQueueNotifyMinWaitMs,
    workflowQueueRetryMaxAttempts,
    workflowQueueTerminalRetentionMs,
  ] = await Promise.all([
    readNumberSetting('workflow_queue_max_running', DEFAULTS.workflowQueueMaxRunning, { min: 1, max: 64 }),
    readNumberSetting('workflow_queue_max_running_per_user', DEFAULTS.workflowQueueMaxRunningPerUser, { min: 1, max: 16 }),
    readNumberSetting('workflow_queue_max_queued_per_user', DEFAULTS.workflowQueueMaxQueuedPerUser, { min: 1, max: 100 }),
    readNumberSetting('workflow_queue_long_threshold_position', DEFAULTS.workflowQueueLongThresholdPosition, { min: 1, max: 1000 }),
    readNumberSetting('workflow_queue_notify_min_wait_ms', DEFAULTS.workflowQueueNotifyMinWaitMs, { min: 0, max: 10 * 60 * 1000 }),
    readNumberSetting('workflow_queue_retry_max_attempts', DEFAULTS.workflowQueueRetryMaxAttempts, { min: 1, max: 10 }),
    readNumberSetting('workflow_queue_terminal_retention_ms', DEFAULTS.workflowQueueTerminalRetentionMs, { min: 60 * 1000 }),
  ]);

  return {
    workflowQueueMaxRunning,
    workflowQueueMaxRunningPerUser,
    workflowQueueMaxQueuedPerUser,
    workflowQueueLongThresholdPosition,
    workflowQueueNotifyMinWaitMs,
    workflowQueueRetryMaxAttempts,
    workflowQueueTerminalRetentionMs,
  };
}

module.exports = {
  DEFAULTS,
  getWorkflowQueueSettings,
};
