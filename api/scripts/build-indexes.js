// backend/scripts/build-indexes.js
/* eslint-disable no-console */
require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    logger.error("❌ MONGODB_URI is not set in environment (.env).");
    process.exit(1);
  }

  logger.info("⏳ Connecting to MongoDB…");
  await mongoose.connect(uri, {
    // adjust if you need authSource, replica, etc.
  });

  // Load models (important: require AFTER connecting so mongoose.model is ready)
  const Collectable = require("../models/Collectable");
const logger = require('../logger');

  // (Optional) log current index specs before syncing
  const before = await Collectable.collection.indexes();
  logger.info("ℹ️ Existing indexes on Collectable:", before.map(i => i.name));

  logger.info("🔧 Building/syncing indexes for Collectable…");
  await Collectable.syncIndexes(); // creates new, drops removed-from-schema

  const after = await Collectable.collection.indexes();
  logger.info("✅ Done. Current indexes on Collectable:", after.map(i => i.name));

  // Nice-to-have: detail the important ones
  const important = after.filter(i =>
    ["identifiers.openlibrary.work_1", "identifiers.isbn13_1", "identifiers.upc_1"].includes(i.name)
  );
  if (important.length) {
    logger.info("⭐ Important indexes present:");
    for (const idx of important) {
      logger.info(` • ${idx.name} ${idx.unique ? "(unique)" : ""} ${idx.partialFilterExpression ? "(partial)" : ""}`);
    }
  }

  await mongoose.disconnect();
  logger.info("👋 Disconnected. All good.");
  process.exit(0);
}

main().catch(async (err) => {
  logger.error("❌ Index build failed:", err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
