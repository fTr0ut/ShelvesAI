/* eslint-disable no-console */
require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

const poolConfig = connectionString
  ? { connectionString, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'shelvesai',
      user: process.env.DB_USER || 'shelves',
      password: process.env.DB_PASSWORD || 'localdev123',
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

const pool = new Pool(poolConfig);

function normalizePayload(payload) {
  if (payload && typeof payload === 'object') return payload;
  return {};
}

function isEmpty(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

async function backfill() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT e.id, e.event_type, e.payload,
              uc.id as collection_id,
              c.id as collectable_id,
              c.title as collectable_title,
              c.primary_creator as collectable_primary_creator,
              c.cover_url as collectable_cover_url,
              c.kind as collectable_kind,
              um.id as manual_id,
              um.name as manual_name,
              um.author as manual_author
       FROM event_logs e
       LEFT JOIN user_collections uc
         ON uc.id = CASE
           WHEN (e.payload->>'itemId') ~ '^[0-9]+$'
           THEN (e.payload->>'itemId')::int
           ELSE NULL
         END
       LEFT JOIN collectables c
         ON c.id = COALESCE(
           uc.collectable_id,
           CASE
             WHEN (e.payload->>'collectableId') ~ '^[0-9]+$'
             THEN (e.payload->>'collectableId')::int
             ELSE NULL
           END
         )
       LEFT JOIN user_manuals um
         ON um.id = COALESCE(
           uc.manual_id,
           CASE
             WHEN (e.payload->>'manualId') ~ '^[0-9]+$'
             THEN (e.payload->>'manualId')::int
             ELSE NULL
           END
         )
       WHERE e.event_type IN ('item.collectable_added', 'item.manual_added')
       ORDER BY e.id`
    );

    console.log(`Found ${result.rows.length} events to inspect.`);
    let updated = 0;

    for (const row of result.rows) {
      const payload = normalizePayload(row.payload);
      const next = { ...payload };
      let changed = false;

      if (row.event_type === 'item.collectable_added') {
        if (isEmpty(next.title) && row.collectable_title) {
          next.title = row.collectable_title;
          changed = true;
        }
        if (isEmpty(next.primaryCreator) && row.collectable_primary_creator) {
          next.primaryCreator = row.collectable_primary_creator;
          changed = true;
        }
        if (isEmpty(next.coverUrl) && row.collectable_cover_url) {
          next.coverUrl = row.collectable_cover_url;
          changed = true;
        }
        if (isEmpty(next.type) && isEmpty(next.kind) && row.collectable_kind) {
          next.type = row.collectable_kind;
          changed = true;
        }
        if (isEmpty(next.collectableId) && row.collectable_id) {
          next.collectableId = row.collectable_id;
          changed = true;
        }
      }

      if (row.event_type === 'item.manual_added') {
        if (isEmpty(next.name) && row.manual_name) {
          next.name = row.manual_name;
          changed = true;
        }
        if (isEmpty(next.title) && row.manual_name) {
          next.title = row.manual_name;
          changed = true;
        }
        if (isEmpty(next.author) && row.manual_author) {
          next.author = row.manual_author;
          changed = true;
        }
        if (isEmpty(next.manualId) && row.manual_id) {
          next.manualId = row.manual_id;
          changed = true;
        }
      }

      if (isEmpty(next.itemId) && row.collection_id) {
        next.itemId = row.collection_id;
        changed = true;
      }

      if (!changed) continue;

      await client.query(
        'UPDATE event_logs SET payload = $1 WHERE id = $2',
        [next, row.id]
      );
      updated += 1;
    }

    console.log(`Backfill complete. Updated ${updated} events.`);
  } catch (err) {
    console.error('Backfill failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

backfill();
