/* eslint-disable no-console */
'use strict';

const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
const envLocalPath = path.join(__dirname, '..', '.env.local');

dotenv.config({ path: envPath });
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

const { query, close } = require('../database/pg');
const { rowToCamelCase } = require('../database/queries/utils');
const collectablesQueries = require('../database/queries/collectables');
const { GameCatalogService } = require('../services/catalog/GameCatalogService');
const logger = require('../logger');

const BATCH_SIZE = Number.parseInt(process.env.IGDB_PLATFORM_BACKFILL_BATCH_SIZE || '100', 10);
const ONLY_MISSING = !['0', 'false', 'no'].includes(String(process.env.IGDB_PLATFORM_BACKFILL_ONLY_MISSING || 'true').trim().toLowerCase());

function normalizeNumericId(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractIgdbGameId(collectable) {
  if (!collectable || typeof collectable !== 'object') return null;
  const identifiers = (collectable.identifiers && typeof collectable.identifiers === 'object' && !Array.isArray(collectable.identifiers))
    ? collectable.identifiers
    : {};
  const igdb = (identifiers.igdb && typeof identifiers.igdb === 'object' && !Array.isArray(identifiers.igdb))
    ? identifiers.igdb
    : {};

  const gameIdList = Array.isArray(igdb.gameId) ? igdb.gameId : [];
  for (const candidate of gameIdList) {
    const parsed = normalizeNumericId(candidate);
    if (parsed) return parsed;
  }

  const directId = normalizeNumericId(igdb.id);
  if (directId) return directId;

  const externalId = String(collectable.externalId || '').trim();
  const extMatch = /^igdb:(\d+)$/i.exec(externalId);
  if (extMatch) {
    return normalizeNumericId(extMatch[1]);
  }

  return null;
}

function buildIgdbGameByIdQuery(gameId) {
  return [
    'fields',
    '*,',
    'involved_companies.developer,',
    'involved_companies.publisher,',
    'involved_companies.company.name,',
    'involved_companies.company.slug,',
    'release_dates.date,',
    'release_dates.region,',
    'release_dates.human,',
    'release_dates.platform.name,',
    'release_dates.platform.abbreviation,',
    'release_dates.platform.id,',
    'platforms.name,',
    'platforms.abbreviation,',
    'platforms.id,',
    'genres.name,',
    'keywords.name,',
    'alternative_names.name,',
    'collection.name,',
    'franchises.name,',
    'cover.image_id,',
    'screenshots.image_id,',
    'artworks.image_id,',
    'websites.url,',
    'videos.name,',
    'videos.video_id,',
    'age_ratings.rating,',
    'age_ratings.category,',
    'age_ratings.synopsis,',
    'external_games.category,',
    'external_games.uid,',
    'external_games.url,',
    'multiplayer_modes.campaigncoop,',
    'multiplayer_modes.dropin,',
    'multiplayer_modes.lancoop,',
    'multiplayer_modes.offlinecoop,',
    'multiplayer_modes.offlinecoopmax,',
    'multiplayer_modes.offlinemax,',
    'multiplayer_modes.onlinecoop,',
    'multiplayer_modes.onlinecoopmax,',
    'multiplayer_modes.onlinemax,',
    'multiplayer_modes.splitscreen,',
    'multiplayer_modes.platform.id,',
    'multiplayer_modes.platform.name,',
    'multiplayer_modes.platform.abbreviation;',
    `where id = ${gameId};`,
    'limit 1;',
  ].join(' ');
}

function normalizePositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractMappedMaxPlayers(mapped) {
  const explicit = normalizePositiveInt(mapped?.maxPlayers ?? mapped?.max_players);
  if (explicit != null) return explicit;

  const multiplayer = mapped?.extras?.igdb?.multiplayer || mapped?.sources?.[0]?.raw?.multiplayer || null;
  if (!multiplayer || typeof multiplayer !== 'object') return null;

  const candidates = [
    multiplayer.maxPlayers,
    multiplayer.max_players,
    multiplayer.maxOnlinePlayers,
    multiplayer.max_online_players,
    multiplayer.maxOfflinePlayers,
    multiplayer.max_offline_players,
    multiplayer.maxOnlineCoopPlayers,
    multiplayer.max_online_coop_players,
    multiplayer.maxOfflineCoopPlayers,
    multiplayer.max_offline_coop_players,
    multiplayer.onlinemax,
    multiplayer.offlinemax,
    multiplayer.onlinecoopmax,
    multiplayer.offlinecoopmax,
  ];

  let max = null;
  for (const candidate of candidates) {
    const parsed = normalizePositiveInt(candidate);
    if (parsed == null) continue;
    if (max == null || parsed > max) max = parsed;
  }
  return max;
}

async function run() {
  const gameCatalog = new GameCatalogService();

  let cursorId = 0;
  let scanned = 0;
  let updated = 0;
  let skippedNoIgdbId = 0;
  let skippedNoIgdbGame = 0;
  let failed = 0;

  logger.info('[IGDBPlatformBackfill] Starting', {
    batchSize: BATCH_SIZE,
    onlyMissing: ONLY_MISSING,
  });

  while (true) {
    const conditions = [
      "kind = ANY($1::text[])",
      'id > $2',
    ];
    if (ONLY_MISSING) {
      conditions.push(`(
        platform_data IS NULL
        OR jsonb_typeof(platform_data) <> 'array'
        OR jsonb_array_length(platform_data) = 0
        OR max_players IS NULL
      )`);
    }

    const result = await query(
      `SELECT id, fingerprint, lightweight_fingerprint, kind, title, primary_creator, system_name, max_players, identifiers, external_id
       FROM collectables
       WHERE ${conditions.join(' AND ')}
       ORDER BY id ASC
       LIMIT $3`,
      [['games', 'game'], cursorId, BATCH_SIZE],
    );

    if (!result.rows.length) break;

    const batch = result.rows.map(rowToCamelCase);
    cursorId = batch[batch.length - 1].id;
    scanned += batch.length;

    for (const collectable of batch) {
      const igdbGameId = extractIgdbGameId(collectable);
      if (!igdbGameId) {
        skippedNoIgdbId += 1;
        continue;
      }

      try {
        const payload = await gameCatalog.callIgdb('games', buildIgdbGameByIdQuery(igdbGameId));
        const game = Array.isArray(payload) ? payload[0] : null;
        if (!game) {
          skippedNoIgdbGame += 1;
          continue;
        }

        const mapped = gameCatalog.mapIgdbGameToCollectable(
          game,
          collectable,
          collectable.lightweightFingerprint,
          null,
        );
        const platformData = Array.isArray(mapped?.platformData) ? mapped.platformData : [];
        const systemName = String(mapped?.systemName || collectable.systemName || '').trim() || null;
        const maxPlayers = extractMappedMaxPlayers(mapped);
        const igdbPayload = (
          mapped?.igdbPayload
          && typeof mapped.igdbPayload === 'object'
          && !Array.isArray(mapped.igdbPayload)
        )
          ? mapped.igdbPayload
          : null;

        await collectablesQueries.upsert({
          fingerprint: collectable.fingerprint,
          lightweightFingerprint: collectable.lightweightFingerprint,
          kind: collectable.kind || 'games',
          title: collectable.title,
          primaryCreator: collectable.primaryCreator || null,
          systemName,
          maxPlayers,
          platformData,
          igdbPayload,
        });

        updated += 1;
      } catch (err) {
        failed += 1;
        logger.warn('[IGDBPlatformBackfill] Failed collectable update', {
          collectableId: collectable.id,
          igdbGameId,
          message: err?.message || String(err),
        });
      }
    }

    logger.info('[IGDBPlatformBackfill] Batch processed', {
      cursorId,
      batchSize: batch.length,
      scanned,
      updated,
      skippedNoIgdbId,
      skippedNoIgdbGame,
      failed,
    });
  }

  logger.info('[IGDBPlatformBackfill] Complete', {
    scanned,
    updated,
    skippedNoIgdbId,
    skippedNoIgdbGame,
    failed,
  });
}

if (require.main === module) {
  run()
    .then(async () => {
      await close();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error('[IGDBPlatformBackfill] Fatal error', { message: err?.message || String(err) });
      try {
        await close();
      } catch (_ignored) {
        // ignore close errors
      }
      process.exit(1);
    });
}

module.exports = {
  extractIgdbGameId,
  buildIgdbGameByIdQuery,
  extractMappedMaxPlayers,
};
