#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { query } = require('../database/pg');
const { ensureCoverMediaForCollectable } = require('../database/queries/media');
const logger = require('../logger');

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDelayInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readArg(name, argv) {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.findIndex((arg) => arg === name);
  if (index >= 0) return argv[index + 1];
  return undefined;
}

function parseOptions(argv = process.argv.slice(2)) {
  const limit = parsePositiveInt(
    readArg('--limit', argv),
    parsePositiveInt(process.env.COVER_MEDIA_BACKFILL_LIMIT, 250),
  );
  const delayMs = parseDelayInt(
    readArg('--delay-ms', argv),
    parseDelayInt(process.env.COVER_MEDIA_BACKFILL_DELAY_MS, 0),
  );
  return { limit, delayMs };
}

async function sleep(ms) {
  if (!ms) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadCandidates(limit) {
  const result = await query(
    `SELECT
        id,
        kind,
        title,
        images,
        cover_url,
        cover_image_url,
        cover_image_source
     FROM collectables
     WHERE cover_media_id IS NULL
       AND cover_image_source = 'local'
       AND (
         cover_url IS NOT NULL
         OR cover_image_url IS NOT NULL
         OR (
           images IS NOT NULL
           AND jsonb_typeof(images) = 'array'
           AND jsonb_array_length(images) > 0
         )
       )
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows || [];
}

async function runBackfill(options = {}) {
  const { limit, delayMs } = {
    ...parseOptions([]),
    ...options,
  };

  logger.info('[cover-media-backfill] Starting one-time cover media retry', { limit, delayMs });
  const candidates = await loadCandidates(limit);
  logger.info('[cover-media-backfill] Candidates loaded', { count: candidates.length });

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i += 1) {
    const row = candidates[i];
    try {
      const result = await ensureCoverMediaForCollectable({
        collectableId: row.id,
        images: Array.isArray(row.images) ? row.images : [],
        coverUrl: row.cover_url || row.cover_image_url || null,
        kind: row.kind,
        title: row.title,
        coverImageSource: 'local',
      });
      if (result?.id) {
        succeeded += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      failed += 1;
      logger.warn('[cover-media-backfill] Retry failed', {
        collectableId: row.id,
        title: row.title || null,
        error: err?.message || String(err),
      });
    }

    if (delayMs > 0 && i < candidates.length - 1) {
      await sleep(delayMs);
    }
  }

  const summary = {
    scanned: candidates.length,
    succeeded,
    skipped,
    failed,
  };
  logger.info('[cover-media-backfill] Complete', summary);
  return summary;
}

if (require.main === module) {
  runBackfill(parseOptions())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('[cover-media-backfill] Job failed', {
        error: err?.message || String(err),
      });
      process.exit(1);
    });
}

module.exports = {
  parseOptions,
  runBackfill,
};
