#!/usr/bin/env node
/**
 * Refresh Job: Re-cache TMDB cover images older than the allowed cache window.
 *
 * Usage:
 *   node jobs/refreshTmdbCoverCache.js
 *
 * Or schedule daily:
 *   0 3 * * * cd /path/to/api && node jobs/refreshTmdbCoverCache.js >> logs/tmdb-cache.log 2>&1
 */

const fs = require('fs/promises');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { query } = require('../database/pg');
const { ensureCoverMediaForCollectable } = require('../database/queries/media');

function parseBool(value, fallback) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const EXPIRY_MONTHS = parsePositiveInt(process.env.TMDB_CACHE_MAX_MONTHS, 6);
const REFRESH_LIMIT = parsePositiveInt(process.env.TMDB_CACHE_REFRESH_LIMIT, 200);
const REFRESH_DELAY_MS = parsePositiveInt(process.env.TMDB_CACHE_REFRESH_DELAY_MS, 0);
const PURGE_ON_FAILURE = parseBool(process.env.TMDB_CACHE_PURGE_ON_FAILURE, true);

const API_ROOT = path.resolve(__dirname, '..');
const RAW_CACHE_ROOT =
  process.env.MEDIA_CACHE_DIR ||
  process.env.COVER_CACHE_DIR ||
  path.join(API_ROOT, 'cache');
const CACHE_ROOT = path.isAbsolute(RAW_CACHE_ROOT)
  ? RAW_CACHE_ROOT
  : path.resolve(API_ROOT, RAW_CACHE_ROOT);

function toAbsolutePath(localPath) {
  const parts = String(localPath || '').split('/').filter(Boolean);
  return path.join(CACHE_ROOT, ...parts);
}

async function deleteLocalFile(localPath) {
  if (!localPath) return false;
  const absolutePath = toAbsolutePath(localPath);
  try {
    await fs.unlink(absolutePath);
    return true;
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn(`[TMDB Cache] Failed to delete ${absolutePath}: ${err.message}`);
    }
    return false;
  }
}

async function purgeCoverCache(row) {
  await deleteLocalFile(row.local_path);
  await query(
    `UPDATE media
     SET local_path = NULL,
         content_type = NULL,
         size_bytes = NULL,
         checksum = NULL
     WHERE id = $1`,
    [row.media_id],
  );
  await query(
    `UPDATE collectables
     SET cover_media_id = NULL,
         cover_image_url = $1,
         cover_image_source = 'external'
     WHERE id = $2`,
    [row.source_url, row.collectable_id],
  );
}

async function waitIfNeeded() {
  if (!REFRESH_DELAY_MS) return;
  await new Promise((resolve) => setTimeout(resolve, REFRESH_DELAY_MS));
}

async function runRefresh() {
  const interval = `${EXPIRY_MONTHS} months`;
  console.log(
    `[TMDB Cache] Refresh start (expiry: ${EXPIRY_MONTHS} months, limit: ${REFRESH_LIMIT}, purgeOnFailure: ${PURGE_ON_FAILURE})`,
  );
  console.log(`[TMDB Cache] Timestamp: ${new Date().toISOString()}`);

  const result = await query(
    `SELECT
        m.id AS media_id,
        m.collectable_id,
        m.source_url,
        m.local_path,
        m.updated_at,
        c.kind,
        c.title
     FROM media m
     JOIN collectables c ON c.id = m.collectable_id
     WHERE c.cover_media_id = m.id
       AND m.local_path IS NOT NULL
       AND (m.provider = 'tmdb'
            OR m.source_url ILIKE 'https://image.tmdb.org/%'
            OR m.source_url ILIKE 'https://media.themoviedb.org/%')
       AND (c.cover_image_source IS NULL OR c.cover_image_source <> 'external')
       AND m.updated_at < NOW() - $2::interval
     ORDER BY m.updated_at ASC
     LIMIT $1`,
    [REFRESH_LIMIT, interval],
  );

  const rows = result.rows || [];
  console.log(`[TMDB Cache] Found ${rows.length} expired cover caches.`);

  let refreshed = 0;
  let purged = 0;
  let failed = 0;
  let cleaned = 0;

  for (const row of rows) {
    try {
      const response = await ensureCoverMediaForCollectable({
        collectableId: row.collectable_id,
        coverMediaId: row.media_id,
        images: [
          {
            kind: 'cover',
            provider: 'tmdb',
            urlLarge: row.source_url,
          },
        ],
        coverUrl: row.source_url,
        kind: row.kind,
        title: row.title,
        coverImageSource: 'local',
        forceRefresh: true,
      });
      if (response && response.localPath) {
        refreshed += 1;
        if (row.local_path && response.localPath !== row.local_path) {
          if (await deleteLocalFile(row.local_path)) {
            cleaned += 1;
          }
        }
      } else {
        failed += 1;
        if (PURGE_ON_FAILURE) {
          await purgeCoverCache(row);
          purged += 1;
        }
      }
    } catch (err) {
      failed += 1;
      console.warn(
        `[TMDB Cache] Refresh failed for collectable ${row.collectable_id}: ${err.message || err}`,
      );
      if (PURGE_ON_FAILURE) {
        try {
          await purgeCoverCache(row);
          purged += 1;
        } catch (purgeErr) {
          console.warn(
            `[TMDB Cache] Purge failed for collectable ${row.collectable_id}: ${purgeErr.message || purgeErr}`,
          );
        }
      }
    }

    await waitIfNeeded();
  }

  console.log(
    `[TMDB Cache] Done. Refreshed: ${refreshed}, Purged: ${purged}, Cleaned: ${cleaned}, Failed: ${failed}.`,
  );
}

runRefresh()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[TMDB Cache] Job failed:', err);
    process.exit(1);
  });
