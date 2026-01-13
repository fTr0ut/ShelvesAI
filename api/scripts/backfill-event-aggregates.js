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

const WINDOW_MINUTES = parseInt(process.env.FEED_AGGREGATE_WINDOW_MINUTES || '15', 10);
const PREVIEW_LIMIT = parseInt(process.env.FEED_AGGREGATE_PREVIEW_LIMIT || '5', 10);

function normalizePayload(payload) {
  if (payload && typeof payload === 'object') return payload;
  return {};
}

async function findExistingAggregate(client, row) {
  const result = await client.query(
    `SELECT *
     FROM event_aggregates
     WHERE user_id = $1
       AND shelf_id = $2
       AND event_type = $3
       AND window_start_utc <= $4
       AND window_end_utc >= $4
     ORDER BY window_start_utc DESC
     LIMIT 1`,
    [row.user_id, row.shelf_id, row.event_type, row.created_at]
  );
  return result.rows[0] || null;
}

async function createAggregate(client, row) {
  const result = await client.query(
    `INSERT INTO event_aggregates (
        user_id,
        shelf_id,
        event_type,
        window_start_utc,
        window_end_utc,
        created_at,
        last_activity_at
     )
     VALUES (
        $1, $2, $3,
        $4::timestamptz,
        $4::timestamptz + make_interval(mins => $5),
        $4::timestamptz,
        $4::timestamptz
     )
     RETURNING *`,
    [row.user_id, row.shelf_id, row.event_type, row.created_at, WINDOW_MINUTES]
  );
  return result.rows[0];
}

async function backfill() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, user_id, shelf_id, event_type, payload, created_at
       FROM event_logs
       WHERE aggregate_id IS NULL
         AND user_id IS NOT NULL
         AND shelf_id IS NOT NULL
         AND event_type IS NOT NULL
       ORDER BY user_id, shelf_id, event_type, created_at, id`
    );

    console.log(`Found ${rows.length} event_logs to backfill.`);
    if (!rows.length) return;

    let currentKey = null;
    let currentAggregate = null;
    let processed = 0;

    for (const row of rows) {
      const key = `${row.user_id}|${row.shelf_id}|${row.event_type}`;

      if (
        key !== currentKey ||
        !currentAggregate ||
        row.created_at > currentAggregate.window_end_utc
      ) {
        currentKey = key;
        currentAggregate = await findExistingAggregate(client, row);
        if (!currentAggregate) {
          currentAggregate = await createAggregate(client, row);
        }
      }

      await client.query(
        'UPDATE event_logs SET aggregate_id = $1 WHERE id = $2',
        [currentAggregate.id, row.id]
      );

      await client.query(
        `UPDATE event_aggregates
         SET item_count = item_count + 1,
             last_activity_at = GREATEST(last_activity_at, $1),
             preview_payloads = CASE
               WHEN jsonb_array_length(preview_payloads) < $2
               THEN preview_payloads || jsonb_build_array($3::jsonb)
               ELSE preview_payloads
             END
         WHERE id = $4`,
        [row.created_at, PREVIEW_LIMIT, JSON.stringify(normalizePayload(row.payload)), currentAggregate.id]
      );

      processed += 1;
      if (processed % 200 === 0) {
        console.log(`Processed ${processed}/${rows.length} events...`);
      }
    }

    console.log(`Backfill complete. Processed ${processed} events.`);
  } catch (err) {
    console.error('Backfill failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

backfill();
