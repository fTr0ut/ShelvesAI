#!/usr/bin/env node
/**
 * Upsert Collectables by prioritized keys (streaming JSONL -> MongoDB)
 *
 * Priority (default): fingerprint, ol.edition, ol.work, ol.author, isbn13, isbn10, lightweightFingerprint
 *   - You can override with: --match fingerprint,ol.edition,isbn13
 *
 * Overwrite behavior:
 *   - Default: $setOnInsert only (no overwrite)
 *   - Optional: --set field1,field2,...  (fields to always $set on existing docs)
 *
 * Usage:
 *  node upsert_collectables.js \
 *    --file /path/collectables.jsonl \
 *    --uri "mongodb://localhost:27017" \
 *    --db shelves --collection Collectable \
 *    --batch 1000 --createIndex \
 *    --match fingerprint,ol.edition,ol.work,isbn13 \
 *    --set description,publisher,format,year
 */

import fs from "node:fs";
import readline from "node:readline";
import { createRequire } from 'node:module';
import { MongoClient } from "mongodb";
const require = createRequire(import.meta.url);
const { makeCollectableFingerprint, makeLightweightFingerprint } = require('../services/collectables/fingerprint');

/* ------------------------------ CLI ------------------------------ */

function argMap(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    }
  }
  return args;
}

/* ----------------------- Fingerprint helpers ---------------------- */

function ensureFingerprints(doc) {
  const kind = doc.kind || doc.type || doc.mediaType || '';
  if (!doc.lightweightFingerprint) {
    doc.lightweightFingerprint = makeLightweightFingerprint({
      title: doc.title || '',
      primaryCreator: doc.primaryCreator || '',
      kind,
    });
  }
  if (!doc.fingerprint) {
    doc.fingerprint = makeCollectableFingerprint({
      title: doc.title || '',
      primaryCreator: doc.primaryCreator || '',
      releaseYear: doc.year || '',
      mediaType: kind,
    });
  }
  return doc;
}

/* ------------------------- Match strategy ------------------------- */

/**
 * Build a MongoDB filter using the first available key
 * according to the given priority list.
 *
 * Supported keys (case-insensitive):
 *   fingerprint
 *   lfp  | lightweightFingerprint
 *   ol.edition | ol.work | ol.author
 *   isbn13 | isbn10
 */
const DEFAULT_MATCH_PRIORITY = [
  "fingerprint",
  "ol.edition",
  "ol.work",
  "ol.author",
  "isbn13",
  "isbn10",
  "lfp",
];

function normalizeMatchList(s) {
  if (!s) return DEFAULT_MATCH_PRIORITY;
  return String(s)
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .map((x) =>
      ({
        "lightweightfingerprint": "lfp",
        "ol.ed": "ol.edition",
        "ol.wk": "ol.work",
        "ol.au": "ol.author",
      }[x] || x)
    )
    .filter(Boolean);
}

function getVal(doc, path) {
  try {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);
  } catch {
    return undefined;
  }
}

function firstMatchFilter(doc, priority) {
  // Gather candidate values
  const candidates = {
    fingerprint: doc.fingerprint,
    lfp: doc.lightweightFingerprint,
    "ol.edition": getVal(doc, "identifiers.openlibrary.edition"),
    "ol.work": getVal(doc, "identifiers.openlibrary.work"),
    "ol.author": getVal(doc, "identifiers.openlibrary.author"),
    isbn13: getVal(doc, "identifiers.isbn13"),
    isbn10: getVal(doc, "identifiers.isbn10"),
  };

  for (const key of priority) {
    const val = candidates[key];
    if (!val) continue;

    switch (key) {
      case "fingerprint":
        return { filter: { fingerprint: val }, keyUsed: key };
      case "lfp":
        return { filter: { lightweightFingerprint: val }, keyUsed: key };
      case "ol.edition":
        return { filter: { "identifiers.openlibrary.edition": val }, keyUsed: key };
      case "ol.work":
        return { filter: { "identifiers.openlibrary.work": val }, keyUsed: key };
      case "ol.author":
        return { filter: { "identifiers.openlibrary.author": val }, keyUsed: key };
      case "isbn13":
        return { filter: { "identifiers.isbn13": val }, keyUsed: key };
      case "isbn10":
        return { filter: { "identifiers.isbn10": val }, keyUsed: key };
    }
  }
  return { filter: null, keyUsed: null };
}

/* ------------------------------ MAIN ----------------------------- */

async function main() {
  const args = argMap(process.argv);

  const file = args.file;
  if (!file) {
    console.error("ERR: --file <path/to/jsonl> is required");
    process.exit(1);
  }

  const uri = args.uri || process.env.MONGO_URI || "mongodb://localhost:27017";
  const dbName = args.db || process.env.MONGO_DB || "test";
  const collName = args.collection || process.env.MONGO_COLLECTION || "Collectable";
  const batchSize = Math.max(1, Number(args.batch || 1000));
  const createIndex = Boolean(args.createIndex);
  const dryRun = Boolean(args.dryRun);

  const matchPriority = normalizeMatchList(args.match);

  // fields to $set (overwrite) on existing docs
  const setFields = String(args.set || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const client = new MongoClient(uri, { maxPoolSize: 10 });
  await client.connect();
  const db = client.db(dbName);
  const coll = db.collection(collName);

  if (createIndex) {
    // Create helpful indexes (idempotent). Unique on fingerprint is recommended.
    try {
      await coll.createIndex({ fingerprint: 1 }, { unique: true, background: true });
    } catch (e) {
      console.error("Index (fingerprint) warn:", e.message);
    }
    try { await coll.createIndex({ "identifiers.openlibrary.edition": 1 }, { background: true }); } catch {}
    try { await coll.createIndex({ "identifiers.openlibrary.work": 1 }, { background: true }); } catch {}
    try { await coll.createIndex({ "identifiers.openlibrary.author": 1 }, { background: true }); } catch {}
    try { await coll.createIndex({ "identifiers.isbn13": 1 }, { background: true }); } catch {}
    try { await coll.createIndex({ "identifiers.isbn10": 1 }, { background: true }); } catch {}
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });

  let buffer = [];
  let total = 0;
  let queued = 0;
  let written = 0;
  let skipped = 0;
  let dupWithinBatch = 0;
  let noMatchKey = 0;

  function shapeUpdate(doc) {
    // Default behavior: INSERT only (no overwrite)
    // Optional: $set selected fields on existing docs
    const update = { $setOnInsert: doc };

    if (setFields.length) {
      const setter = {};
      for (const f of setFields) {
        // only include fields that exist on the incoming doc
        const v = getVal(doc, f);
        if (v !== undefined) setter[f] = v;
      }
      if (Object.keys(setter).length) update.$set = setter;
    }
    return update;
  }

  async function flushBatch() {
    if (!buffer.length) return;

    // Deduplicate by filter signature within the batch to avoid useless work
    const seen = new Set();
    const ops = [];

    for (const { filter, doc } of buffer) {
      const sig = JSON.stringify(filter);
      if (seen.has(sig)) {
        dupWithinBatch++;
        continue;
      }
      seen.add(sig);

      const update = shapeUpdate(doc);
      ops.push({ updateOne: { filter, update, upsert: true } });
    }

    buffer = [];

    if (!ops.length || dryRun) {
      written += ops.length;
      return;
    }

    try {
      const res = await coll.bulkWrite(ops, { ordered: false });
      written += res.upsertedCount + (res.matchedCount || 0);
    } catch (err) {
      console.error("bulkWrite error:", err.message);
      // If needed, inspect err.writeErrors here.
    }
  }

  rl.on("line", (line) => {
    if (!line) return;
    total++;

    let doc;
    try { doc = JSON.parse(line); }
    catch { skipped++; return; }

    // ensure fingerprints exist if fields allow it
    if (!doc.fingerprint || !doc.lightweightFingerprint) {
      doc = ensureFingerprints(doc);
    }

    const { filter, keyUsed } = firstMatchFilter(doc, matchPriority);
    if (!filter) {
      noMatchKey++;
      skipped++;
      return;
    }

    buffer.push({ filter, doc, keyUsed });
    queued++;

    if (buffer.length >= batchSize) {
      rl.pause();
      flushBatch().finally(() => rl.resume());
    }

    if (total % 10000 === 0) {
      console.error(
        `Progress: read=${total}, queued=${queued}, written≈${written}, skipped=${skipped}, noKey=${noMatchKey}, dupInBatch=${dupWithinBatch}`
      );
    }
  });

  rl.once("close", async () => {
    await flushBatch();
    console.error(
      `Done. read=${total}, written≈${written}, skipped=${skipped}, noKey=${noMatchKey}, dupInBatch=${dupWithinBatch}`
    );
    await client.close();
  });

  rl.once("error", async (e) => {
    console.error("Read error:", e);
    try { await client.close(); } catch {}
    process.exit(1);
  });
}

main().catch(async (e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
