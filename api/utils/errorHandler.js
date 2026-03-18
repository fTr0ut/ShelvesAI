/**
 * Centralized error-handling utilities.
 *
 * Provides consistent error response shapes and structured logging.
 * Apply to controllers incrementally — not every controller needs to be
 * migrated in a single pass.
 */

/**
 * Send a structured JSON error response.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {number} status - HTTP status code.
 * @param {string} message - Human-readable error message (becomes `error` field).
 * @param {object} [details={}] - Optional extra fields merged into the response body.
 */
function sendError(res, status, message, details = {}) {
  return res.status(status).json({ error: message, ...details });
}

/**
 * Log an error with structured context.
 *
 * Writes to stderr via console.error so it integrates with existing log
 * aggregation without requiring a third-party library.
 *
 * @param {string} context - Short label identifying where the error occurred
 *   (e.g. `'listShelves'`, `'POST /collectables'`).
 * @param {Error|unknown} error - The caught error.
 * @param {object} [metadata={}] - Optional key/value pairs to include in the
 *   log output (e.g. `{ userId, shelfId }`).
 */
function logError(context, error, metadata = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[${context}]`, message, { ...metadata, stack });
}

module.exports = { sendError, logError };
