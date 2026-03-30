const logger = require('../logger');

class OutboundLimiter {
  constructor({ name, concurrency = 1, minIntervalMs = 0 }) {
    this.name = name;
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.minIntervalMs = Math.max(0, Number(minIntervalMs) || 0);
    this.activeCount = 0;
    this.queue = [];
    this.lastDispatchAt = 0;
    this.timer = null;
  }

  schedule(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    if (this.activeCount >= this.concurrency) return;
    if (!this.queue.length) return;

    const now = Date.now();
    const waitMs = this.minIntervalMs - (now - this.lastDispatchAt);
    if (waitMs > 0) {
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this._drain();
        }, waitMs);
      }
      return;
    }

    const work = this.queue.shift();
    this.activeCount += 1;
    this.lastDispatchAt = Date.now();

    Promise.resolve()
      .then(() => work.task())
      .then(work.resolve)
      .catch(work.reject)
      .finally(() => {
        this.activeCount = Math.max(0, this.activeCount - 1);
        this._drain();
      });

    if (this.activeCount < this.concurrency) {
      this._drain();
    }
  }
}

function parseIntEnv(name, fallback, { min = 1, max = 1024 } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

const limiterConfigs = {
  gemini: {
    concurrency: parseIntEnv('OUTBOUND_GEMINI_CONCURRENCY', 2),
    minIntervalMs: parseIntEnv('OUTBOUND_GEMINI_MIN_INTERVAL_MS', 0, { min: 0, max: 60000 }),
  },
  s3_write: {
    concurrency: parseIntEnv('OUTBOUND_S3_WRITE_CONCURRENCY', 3),
    minIntervalMs: parseIntEnv('OUTBOUND_S3_WRITE_MIN_INTERVAL_MS', 0, { min: 0, max: 60000 }),
  },
  s3_read: {
    concurrency: parseIntEnv('OUTBOUND_S3_READ_CONCURRENCY', 6),
    minIntervalMs: parseIntEnv('OUTBOUND_S3_READ_MIN_INTERVAL_MS', 0, { min: 0, max: 60000 }),
  },
  tmdb: {
    concurrency: parseIntEnv('OUTBOUND_TMDB_CONCURRENCY', 4),
    minIntervalMs: parseIntEnv('OUTBOUND_TMDB_MIN_INTERVAL_MS', 0, { min: 0, max: 60000 }),
  },
  igdb: {
    concurrency: parseIntEnv('OUTBOUND_IGDB_CONCURRENCY', 2),
    minIntervalMs: parseIntEnv('OUTBOUND_IGDB_MIN_INTERVAL_MS', 0, { min: 0, max: 60000 }),
  },
  open_library: {
    concurrency: parseIntEnv('OUTBOUND_OPEN_LIBRARY_CONCURRENCY', 4),
    minIntervalMs: parseIntEnv('OUTBOUND_OPEN_LIBRARY_MIN_INTERVAL_MS', 0, { min: 0, max: 60000 }),
  },
  hardcover: {
    concurrency: parseIntEnv('OUTBOUND_HARDCOVER_CONCURRENCY', 2),
    minIntervalMs: parseIntEnv('OUTBOUND_HARDCOVER_MIN_INTERVAL_MS', 0, { min: 0, max: 60000 }),
  },
};

const registry = new Map();

function getLimiter(name) {
  if (registry.has(name)) return registry.get(name);
  const config = limiterConfigs[name] || { concurrency: 1, minIntervalMs: 0 };
  const limiter = new OutboundLimiter({
    name,
    concurrency: config.concurrency,
    minIntervalMs: config.minIntervalMs,
  });
  registry.set(name, limiter);
  logger.info('[OutboundLimiter] initialized', {
    name,
    concurrency: limiter.concurrency,
    minIntervalMs: limiter.minIntervalMs,
  });
  return limiter;
}

function withLimiter(name, task) {
  return getLimiter(name).schedule(task);
}

const limitGemini = (task) => withLimiter('gemini', task);
const limitS3Write = (task) => withLimiter('s3_write', task);
const limitS3Read = (task) => withLimiter('s3_read', task);
const limitTmdb = (task) => withLimiter('tmdb', task);
const limitIgdb = (task) => withLimiter('igdb', task);
const limitOpenLibrary = (task) => withLimiter('open_library', task);
const limitHardcover = (task) => withLimiter('hardcover', task);

module.exports = {
  withLimiter,
  limitGemini,
  limitS3Write,
  limitS3Read,
  limitTmdb,
  limitIgdb,
  limitOpenLibrary,
  limitHardcover,
};
