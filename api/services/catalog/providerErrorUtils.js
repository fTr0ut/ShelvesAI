function extractStatusCode(error) {
  if (!error) return null;
  if (Number.isFinite(Number(error.statusCode))) return Number(error.statusCode);
  if (Number.isFinite(Number(error.status))) return Number(error.status);
  const message = String(error.message || '');
  const match = message.match(/\b(4\d\d|5\d\d)\b/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyProviderError(error) {
  const message = String(error?.message || '').toLowerCase();
  const statusCode = extractStatusCode(error);

  const isAbort = Boolean(
    error?.name === 'AbortError'
      || message.includes('the user aborted a request')
      || message.includes('aborted')
      || message.includes('timeout')
      || message.includes('timed out')
  );
  if (isAbort) {
    return { isHardError: true, reason: 'timeout_or_abort', statusCode };
  }

  if (statusCode === 429 || message.includes('429') || message.includes('rate limit')) {
    return { isHardError: true, reason: 'rate_limited', statusCode: 429 };
  }

  if (statusCode && statusCode >= 500) {
    return { isHardError: true, reason: 'server_error', statusCode };
  }

  const isNetworkError = Boolean(
    message.includes('econnreset')
      || message.includes('econnrefused')
      || message.includes('enotfound')
      || message.includes('etimedout')
      || message.includes('socket hang up')
      || message.includes('fetch failed')
      || message.includes('network')
      || message.includes('no available server')
  );
  if (isNetworkError) {
    return { isHardError: true, reason: 'network_error', statusCode };
  }

  return { isHardError: false, reason: 'soft_error', statusCode };
}

function isHardProviderError(error) {
  return classifyProviderError(error).isHardError;
}

module.exports = {
  classifyProviderError,
  extractStatusCode,
  isHardProviderError,
};
