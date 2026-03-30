/* eslint-disable no-console */
'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Load base env first, then allow local overrides for developer testing.
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const fetch = require('node-fetch');
const { query, close } = require('../database/pg');
const { rowToCamelCase } = require('../database/queries/utils');
const logger = require('../logger');

const TMDB_MAX_SOFT_REQUESTS_PER_SECOND = 50;
const TMDB_DEFAULT_REQUESTS_PER_SECOND = 40;
const BATCH_SIZE = (() => {
  const raw = Number.parseInt(process.env.CAST_BACKFILL_BATCH_SIZE || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 100;
})();
const TMDB_REQUESTS_PER_SECOND = (() => {
  const raw = Number.parseFloat(
    process.env.TMDB_BACKFILL_MAX_RPS
      || process.env.TMDB_MAX_RPS
      || process.env.TMDB_MAX_REQUESTS_PER_SECOND
      || '',
  );
  if (!Number.isFinite(raw) || raw <= 0) return TMDB_DEFAULT_REQUESTS_PER_SECOND;
  return Math.min(raw, TMDB_MAX_SOFT_REQUESTS_PER_SECOND);
})();
const TMDB_429_MAX_RETRIES = (() => {
  const raw = Number.parseInt(process.env.TMDB_BACKFILL_429_MAX_RETRIES || '5', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 5;
})();
const TMDB_429_FALLBACK_WAIT_MS = (() => {
  const raw = Number.parseInt(process.env.TMDB_BACKFILL_429_FALLBACK_WAIT_MS || '1000', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1000;
})();

const TARGET_KINDS = ['movies', 'movie', 'tv'];
const TMDB_BASE_URL = String(process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3').replace(/\/$/, '');

function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(rawRetryAfter, nowMs = Date.now()) {
  const value = String(rawRetryAfter || '').trim();
  if (!value) return null;

  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const retryDateMs = Date.parse(value);
  if (!Number.isFinite(retryDateMs)) return null;
  return Math.max(0, retryDateMs - nowMs);
}

function createTmdbRateLimiter(requestsPerSecond) {
  const safeRps = Number.isFinite(requestsPerSecond) && requestsPerSecond > 0
    ? Math.min(requestsPerSecond, TMDB_MAX_SOFT_REQUESTS_PER_SECOND)
    : TMDB_DEFAULT_REQUESTS_PER_SECOND;
  const minIntervalMs = Math.ceil(1000 / safeRps);
  let nextAllowedAtMs = 0;

  return {
    requestsPerSecond: safeRps,
    minIntervalMs,
    async waitTurn() {
      const nowMs = Date.now();
      if (nowMs < nextAllowedAtMs) {
        await sleep(nextAllowedAtMs - nowMs);
      }
      nextAllowedAtMs = Date.now() + minIntervalMs;
    },
    pushBack(waitMs) {
      const safeWaitMs = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 0;
      nextAllowedAtMs = Math.max(nextAllowedAtMs, Date.now() + safeWaitMs);
    },
  };
}

function normalizeCastName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeCastMembers(cast = []) {
  if (!Array.isArray(cast)) return [];
  const out = [];
  for (const member of cast) {
    const name = String(member?.name || '').trim();
    if (!name) continue;
    const nameNormalized = normalizeCastName(name);
    if (!nameNormalized) continue;

    const parsedPersonId = Number.parseInt(member?.id, 10);
    const parsedOrder = Number.parseInt(member?.order, 10);
    out.push({
      personId: Number.isFinite(parsedPersonId) ? parsedPersonId : null,
      name,
      nameNormalized,
      character: String(member?.character || '').trim() || null,
      order: Number.isFinite(parsedOrder) ? parsedOrder : null,
      profilePath: String(member?.profile_path || '').trim() || null,
    });
  }
  return out;
}

function pickFirstString(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = String(entry || '').trim();
      if (normalized) return normalized;
    }
    return null;
  }
  const normalized = String(value || '').trim();
  return normalized || null;
}

function extractTmdbLookup(row) {
  if (!row || typeof row !== 'object') return null;
  const kind = String(row.kind || '').trim().toLowerCase();
  const identifiers = row.identifiers && typeof row.identifiers === 'object' && !Array.isArray(row.identifiers)
    ? row.identifiers
    : {};
  const tmdb = identifiers.tmdb && typeof identifiers.tmdb === 'object' && !Array.isArray(identifiers.tmdb)
    ? identifiers.tmdb
    : {};
  const movieFromIdentifiers = pickFirstString(tmdb.movie);
  const tvFromIdentifiers = pickFirstString(tmdb.tv);

  const externalId = String(row.externalId || row.external_id || '').trim();
  const externalMovieId = externalId.startsWith('tmdb:') ? externalId.slice('tmdb:'.length) : null;
  const externalTvId = externalId.startsWith('tmdb_tv:') ? externalId.slice('tmdb_tv:'.length) : null;

  let mediaType = null;
  if (kind === 'tv') mediaType = 'tv';
  if (kind === 'movie' || kind === 'movies') mediaType = 'movie';
  if (!mediaType) {
    if (tvFromIdentifiers || externalTvId) mediaType = 'tv';
    else if (movieFromIdentifiers || externalMovieId) mediaType = 'movie';
  }
  if (!mediaType) return null;

  const tmdbId = mediaType === 'tv'
    ? (tvFromIdentifiers || externalTvId)
    : (movieFromIdentifiers || externalMovieId);
  if (!tmdbId) return null;

  return {
    mediaType,
    tmdbId: String(tmdbId).trim(),
  };
}

function buildBatchUpdate(rows) {
  if (!rows.length) return null;

  const valuePlaceholders = [];
  const values = [];
  let paramIndex = 1;
  for (const row of rows) {
    valuePlaceholders.push(`($${paramIndex}::int, $${paramIndex + 1}::jsonb)`);
    values.push(row.id, JSON.stringify(row.castMembers));
    paramIndex += 2;
  }

  const text = `
    UPDATE collectables
    SET cast_members = v.cast_members::jsonb,
        updated_at = NOW()
    FROM (VALUES ${valuePlaceholders.join(', ')}) AS v(id, cast_members)
    WHERE collectables.id = v.id
  `;

  return { text, values };
}

async function fetchTmdbDetails({ tmdbId, mediaType, apiKey, rateLimiter }) {
  if (!apiKey || !tmdbId || !mediaType) return null;
  const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
  const params = new URLSearchParams();
  params.set('append_to_response', 'credits');
  params.set('language', 'en-US');
  const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?${params.toString()}`;

  for (let attempt = 0; attempt <= TMDB_429_MAX_RETRIES; attempt += 1) {
    try {
      if (rateLimiter?.waitTurn) {
        await rateLimiter.waitTurn();
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'User-Agent': 'ShelvesAI/1.0 (cast-backfill)',
        },
      });

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after')) ?? TMDB_429_FALLBACK_WAIT_MS;
        const waitMs = Math.max(retryAfterMs, rateLimiter?.minIntervalMs || 0);
        const isFinalAttempt = attempt >= TMDB_429_MAX_RETRIES;
        logger.warn('[CastBackfill] TMDB rate limited', {
          tmdbId,
          mediaType,
          attempt: attempt + 1,
          maxAttempts: TMDB_429_MAX_RETRIES + 1,
          waitMs,
        });

        if (isFinalAttempt) {
          const body = await response.text();
          logger.warn('[CastBackfill] TMDB request failed after retries', {
            tmdbId,
            mediaType,
            status: response.status,
            body: body.slice(0, 200),
          });
          return null;
        }

        if (rateLimiter?.pushBack) {
          rateLimiter.pushBack(waitMs);
        }
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        logger.warn('[CastBackfill] TMDB request failed', {
          tmdbId,
          mediaType,
          status: response.status,
          body: body.slice(0, 200),
        });
        return null;
      }

      return await response.json();
    } catch (err) {
      logger.warn('[CastBackfill] TMDB request error', {
        tmdbId,
        mediaType,
        attempt: attempt + 1,
        maxAttempts: TMDB_429_MAX_RETRIES + 1,
        error: err?.message || String(err),
      });
      return null;
    }
  }

  return null;
}

async function main() {
  const apiKey = String(process.env.TMDB_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('TMDB_API_KEY is required for cast backfill');
  }
  const rateLimiter = createTmdbRateLimiter(TMDB_REQUESTS_PER_SECOND);

  let cursorId = 0;
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  logger.info('[CastBackfill] Starting cast_members backfill...', {
    tmdbRequestsPerSecond: rateLimiter.requestsPerSecond,
    tmdbMinIntervalMs: rateLimiter.minIntervalMs,
    tmdb429MaxRetries: TMDB_429_MAX_RETRIES,
  });

  while (true) {
    const result = await query(
      `SELECT id, kind, identifiers, external_id
       FROM collectables
       WHERE cast_members IS NULL
         AND kind = ANY($1::text[])
         AND id > $2
       ORDER BY id ASC
       LIMIT $3`,
      [TARGET_KINDS, cursorId, BATCH_SIZE],
    );

    if (!result.rows.length) break;

    const rows = result.rows.map(rowToCamelCase);
    cursorId = rows[rows.length - 1].id;
    scanned += rows.length;

    const updates = [];
    for (const row of rows) {
      const lookup = extractTmdbLookup(row);
      if (!lookup) {
        skipped += 1;
        continue;
      }

      const details = await fetchTmdbDetails({ ...lookup, apiKey, rateLimiter });
      if (!details) {
        failed += 1;
        continue;
      }

      const castMembers = normalizeCastMembers(details?.credits?.cast);
      updates.push({
        id: row.id,
        castMembers,
      });
    }

    const batchUpdate = buildBatchUpdate(updates);
    if (batchUpdate) {
      await query(batchUpdate.text, batchUpdate.values);
      updated += updates.length;
    }

    logger.info('[CastBackfill] Batch processed', {
      cursorId,
      batchScanned: rows.length,
      batchUpdated: updates.length,
      totalScanned: scanned,
      totalUpdated: updated,
      totalSkipped: skipped,
      totalFailed: failed,
    });
  }

  logger.info('[CastBackfill] Complete', {
    scanned,
    updated,
    skipped,
    failed,
  });
}

if (require.main === module) {
  main()
    .then(async () => {
      await close();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error('[CastBackfill] Fatal error', { error: err?.message || String(err) });
      try {
        await close();
      } catch (_) {
        // ignore close errors
      }
      process.exit(1);
    });
}

module.exports = {
  normalizeCastName,
  normalizeCastMembers,
  extractTmdbLookup,
  buildBatchUpdate,
  parseRetryAfterMs,
  createTmdbRateLimiter,
};
