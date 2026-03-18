const DEFAULT_TIMEOUT_MS = 10000;

function resolveTimeoutMs(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return timeoutMs;
}

async function withTimeout(promiseOrFactory, timeoutMs, label = 'Operation') {
  const ms = resolveTimeoutMs(timeoutMs);
  let timeoutId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  try {
    const promise =
      typeof promiseOrFactory === 'function'
        ? promiseOrFactory()
        : promiseOrFactory;
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  withTimeout,
};
