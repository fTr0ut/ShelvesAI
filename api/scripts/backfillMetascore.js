/* eslint-disable no-console */
'use strict';

require('dotenv').config();

const { query, close } = require('../database/pg');
const { MetadataScorer } = require('../services/catalog/MetadataScorer');
const { getApiContainerKey } = require('../services/config/shelfTypeResolver');
const { rowToCamelCase } = require('../database/queries/utils');
const logger = require('../logger');

const BATCH_SIZE = 500;

const SELECT_SQL = `
  SELECT id, kind, title, primary_creator, creators, publishers, year, description,
         cover_url, cover_image_url, images, identifiers, tags, genre, runtime,
         system_name
  FROM collectables
  WHERE metascore IS NULL
  ORDER BY id
  LIMIT $1 OFFSET $2
`;

const COUNT_SQL = `SELECT COUNT(*) AS total FROM collectables WHERE metascore IS NULL`;

/**
 * Build a batch UPDATE statement using a VALUES list.
 * Returns { text, values } or null if rows is empty.
 *
 * @param {Array<{ id: number, metascore: object }>} rows
 * @returns {{ text: string, values: any[] }|null}
 */
function buildBatchUpdate(rows) {
  if (!rows.length) return null;

  const valuePlaceholders = [];
  const values = [];
  let paramIndex = 1;

  for (const { id, metascore } of rows) {
    valuePlaceholders.push(`($${paramIndex}::int, $${paramIndex + 1}::jsonb)`);
    values.push(id, JSON.stringify(metascore));
    paramIndex += 2;
  }

  const text = `
    UPDATE collectables
    SET metascore = v.metascore::jsonb,
        updated_at = NOW()
    FROM (VALUES ${valuePlaceholders.join(', ')}) AS v(id, metascore)
    WHERE collectables.id = v.id
  `;

  return { text, values };
}

async function main() {
  const startTime = Date.now();
  const scorer = new MetadataScorer();

  // Get total count of rows to process
  const countResult = await query(COUNT_SQL);
  const total = parseInt(countResult.rows[0].total, 10);

  if (total === 0) {
    logger.info('[Backfill] No collectables with metascore IS NULL found. Nothing to do.');
    return;
  }

  logger.info(`[Backfill] Starting. ${total} collectables to score.`);

  let offset = 0;
  let totalProcessed = 0;
  let totalScored = 0;
  let totalSkipped = 0;

  while (true) {
    const { rows } = await query(SELECT_SQL, [BATCH_SIZE, offset]);

    if (!rows.length) break;

    const updateRows = [];
    let batchScored = 0;
    let batchSkipped = 0;

    for (const rawRow of rows) {
      const row = rowToCamelCase(rawRow);
      const containerType = getApiContainerKey(row.kind);

      if (!containerType) {
        batchSkipped += 1;
      } else {
        batchScored += 1;
      }

      // Score the row — returns { score: null, ... } for unknown/null containerType
      const metascore = scorer.score(row, containerType);

      updateRows.push({ id: row.id, metascore });
    }

    // Batch UPDATE all rows in this batch
    const updateQuery = buildBatchUpdate(updateRows);
    if (updateQuery) {
      await query(updateQuery.text, updateQuery.values);
    }

    totalProcessed += rows.length;
    totalScored += batchScored;
    totalSkipped += batchSkipped;

    logger.info(
      `[Backfill] Processed ${totalProcessed}/${total} (${batchScored} scored, ${batchSkipped} skipped — no container type)`
    );

    // Since we filter WHERE metascore IS NULL and we just wrote metascore for this batch,
    // offset stays at 0 — processed rows are excluded by the WHERE clause on the next iteration.
    if (rows.length < BATCH_SIZE) break;
  }

  const elapsedMs = Date.now() - startTime;
  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  logger.info('[Backfill] Complete.');
  logger.info(`  Total processed : ${totalProcessed}`);
  logger.info(`  Scored          : ${totalScored}`);
  logger.info(`  Skipped (no type): ${totalSkipped}`);
  logger.info(`  Elapsed         : ${elapsedSec}s`);
}

main()
  .then(async () => {
    await close();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error('[Backfill] Fatal error:', err.message || err);
    try {
      await close();
    } catch (_) {
      // ignore pool close errors
    }
    process.exit(1);
  });
