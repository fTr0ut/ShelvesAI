'use strict';

const path = require('path');
const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const { getJobId, getUserId } = require('./context');
const SPLAT = Symbol.for('splat');

const isDev = process.env.NODE_ENV !== 'production';

// Custom format that injects jobId from AsyncLocalStorage into every log entry
const injectJobId = format((info) => {
  info.jobId = getJobId();
  if (info.userId == null) {
    const userId = getUserId();
    if (userId) info.userId = userId;
  }
  return info;
});

// Normalize extra logger args (e.g. logger.error('msg', err.message)) so they are never dropped.
const injectExtraArgs = format((info) => {
  const args = info[SPLAT];
  if (!Array.isArray(args) || args.length === 0) return info;

  const normalizedArgs = args
    .filter((arg) => arg == null || ['string', 'number', 'boolean', 'bigint'].includes(typeof arg))
    .map((arg) => (arg == null ? null : String(arg)));

  if (normalizedArgs.length === 0) return info;

  if (normalizedArgs.length === 1) {
    info.detail = normalizedArgs[0];
  } else {
    info.args = normalizedArgs;
  }

  return info;
});

// Console format: [jobId] LEVEL  message  {meta}
const consoleFormat = format.combine(
  injectJobId(),
  injectExtraArgs(),
  format.errors({ stack: true }),
  format.timestamp(),
  format.colorize(),
  format.printf(({ level, message, timestamp, jobId, userId, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? '  ' + JSON.stringify(meta)
      : '';
    const userSegment = userId ? ` [user:${userId}]` : '';
    return `[${jobId}] ${timestamp}${userSegment} ${level}  ${message}${metaStr}`;
  })
);

// File format: structured JSON, one entry per line
const fileFormat = format.combine(
  injectJobId(),
  injectExtraArgs(),
  format.errors({ stack: true }),
  format.timestamp(),
  format.json()
);

const logTransports = [
  new transports.Console({
    format: consoleFormat,
    level: isDev ? 'debug' : 'info',
  }),
  new transports.DailyRotateFile({
    format: fileFormat,
    dirname: path.join(__dirname, 'logs'),
    filename: 'api-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxFiles: '30d',
    level: 'info',
  }),
];

const logger = createLogger({
  transports: logTransports,
  exitOnError: false,
});

module.exports = logger;
