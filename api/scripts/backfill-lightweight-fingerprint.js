// backend/scripts/backfill-lightweight-fingerprint.js
/* eslint-disable no-console */
require("dotenv").config();
const mongoose = require("mongoose");
const { makeLightweightFingerprint } = require("../services/collectables/fingerprint");


async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set in environment (.env)");
    process.exit(1);
  }

  console.log("[backfill] connecting to MongoDB");
  await mongoose.connect(uri);

  const Collectable = require("../models/Collectable");

  const cursor = Collectable.find({}).cursor();
  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  const bulkOps = [];
  const flush = async () => {
    if (!bulkOps.length) return;
    try {
      const result = await Collectable.bulkWrite(bulkOps);
      console.log("[backfill] bulkWrite", result.nModified || result.modifiedCount || 0);
    } catch (err) {
      console.error("[backfill] bulkWrite failed", err?.message || err);
    }
    bulkOps.length = 0;
  };

  for await (const doc of cursor) {
    scanned += 1;

        const title = doc.title || doc.name || "";
    const creators = Array.isArray(doc.creators) ? doc.creators.filter(Boolean) : [];
    const primary = doc.primaryCreator || doc.author || creators[0] || "";

    if (!title) {
      skipped += 1;
      continue;
    }

    const fingerprint = makeLightweightFingerprint(title, primary);

    if (!fingerprint) {
      skipped += 1;
      continue;
    }

    if (doc.lightweightFingerprint === fingerprint) {
      skipped += 1;
      continue;
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { lightweightFingerprint: fingerprint } },
      },
    });
    updated += 1;

    if (bulkOps.length >= 500) {
      await flush();
    }
  }

  await flush();
  await mongoose.disconnect();

  console.log("[backfill] scanned", scanned, "records");
  console.log("[backfill] updated", updated, "records");
  console.log("[backfill] skipped", skipped, "records");

  process.exit(0);
}

main().catch(async (err) => {
  console.error("[backfill] failed", err?.message || err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
