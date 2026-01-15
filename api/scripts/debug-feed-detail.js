const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('[debug-feed-detail] Missing .env at:', envPath);
  process.exit(1);
}

dotenv.config({ path: envPath, override: true });

const DEFAULT_USERNAMES = new Set(['test']);
const DEFAULT_PASSWORDS = new Set(['test123']);

function bail(message) {
  console.error(`[debug-feed-detail] ${message}`);
  process.exit(1);
}

function requireEnv(name) {
  if (!process.env[name]) {
    bail(`Missing required env var: ${name}`);
  }
}

function buildDbConfig() {
  requireEnv('POSTGRES_HOST');
  requireEnv('POSTGRES_PORT');
  requireEnv('POSTGRES_DB');
  requireEnv('POSTGRES_USER');
  requireEnv('POSTGRES_PASSWORD');

  if (DEFAULT_USERNAMES.has(process.env.POSTGRES_USER)) {
    bail('POSTGRES_USER uses a default username. Set a real DB username in .env.');
  }
  if (DEFAULT_PASSWORDS.has(process.env.POSTGRES_PASSWORD)) {
    bail('POSTGRES_PASSWORD uses a default password. Set a real DB password in .env.');
  }

  return {
    host: process.env.POSTGRES_HOST,
    port: Number.parseInt(process.env.POSTGRES_PORT, 10),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: false,
  };
}

function flattenPayloadItems(payloads) {
  const out = [];
  if (!Array.isArray(payloads)) return out;
  payloads.forEach((payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.items)) {
      payload.items.forEach((item) => {
        if (item && typeof item === 'object') out.push(item);
      });
      return;
    }
    out.push(payload);
  });
  return out;
}

function extractItemIdsFromPayloads(payloads) {
  const ids = [];
  payloads.forEach((payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.itemIds)) {
      payload.itemIds.forEach((id) => {
        const parsed = Number.parseInt(id, 10);
        if (Number.isFinite(parsed)) ids.push(parsed);
      });
      return;
    }
    const parsed = Number.parseInt(payload.itemId, 10);
    if (Number.isFinite(parsed)) ids.push(parsed);
  });
  return ids;
}

async function run() {
  const aggregateId = process.argv[2];
  if (!aggregateId) {
    bail('Usage: node scripts/debug-feed-detail.js <aggregateId>');
  }

  const client = new Client(buildDbConfig());
  await client.connect();

  try {
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const aggregateResult = await client.query(
      `SELECT id, event_type, shelf_id, collectable_id, checkin_status, visibility, note
       FROM event_aggregates
       WHERE id = $1`,
      [aggregateId]
    );

    if (!aggregateResult.rows.length) {
      bail(`No event_aggregate found for id ${aggregateId}`);
    }

    const aggregate = aggregateResult.rows[0];
    console.log('[debug-feed-detail] aggregate', aggregate);

    const logsResult = await client.query(
      `SELECT id, event_type, payload, created_at
       FROM event_logs
       WHERE aggregate_id = $1
       ORDER BY created_at ASC`,
      [aggregateId]
    );

    const payloads = logsResult.rows.map((row) => row.payload || {});
    console.log(`[debug-feed-detail] logs: ${logsResult.rows.length}`);

    const flattened = flattenPayloadItems(payloads);
    const itemIds = extractItemIdsFromPayloads(payloads);
    const payloadCollectableIds = flattened
      .map((payload) => payload?.collectableId || payload?.collectable_id || payload?.collectable?.id || null)
      .filter((id) => id != null)
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isFinite(id));

    console.log('[debug-feed-detail] payload item ids:', itemIds);
    console.log('[debug-feed-detail] payload collectable ids:', payloadCollectableIds);

    if (itemIds.length) {
      const itemsResult = await client.query(
        `SELECT uc.id, uc.collectable_id, uc.manual_id,
                c.title as collectable_title,
                um.name as manual_name
         FROM user_collections uc
         LEFT JOIN collectables c ON c.id = uc.collectable_id
         LEFT JOIN user_manuals um ON um.id = uc.manual_id
         WHERE uc.id = ANY($1)`,
        [itemIds]
      );
      console.log('[debug-feed-detail] user_collections matches:', itemsResult.rows);
    } else {
      console.log('[debug-feed-detail] No item ids in payloads.');
    }

    if (payloadCollectableIds.length) {
      const collectableResult = await client.query(
        `SELECT id, title
         FROM collectables
         WHERE id = ANY($1)`,
        [payloadCollectableIds]
      );
      console.log('[debug-feed-detail] collectables found:', collectableResult.rows);
    } else {
      console.log('[debug-feed-detail] No collectable ids in payloads.');
    }

    const preview = flattened.map((payload) => ({
      itemId: payload.itemId || payload.id || null,
      collectableId: payload.collectableId || payload.collectable_id || payload.collectable?.id || null,
      title: payload.title || payload.name || null,
      primaryCreator: payload.primaryCreator || payload.author || null,
      coverUrl: payload.coverUrl || null,
      kind: payload.type || payload.kind || null,
    }));

    console.log('[debug-feed-detail] payload preview:', preview);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('[debug-feed-detail] error:', err);
  process.exit(1);
});
