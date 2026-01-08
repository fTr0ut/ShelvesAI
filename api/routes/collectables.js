const express = require("express");
const mongoose = require("mongoose");
const { auth } = require("../middleware/auth");
const Collectable = require("../models/Collectable");

const router = express.Router();

router.use(auth);

function normalizeTags(input) {
  if (input == null) return [];
  const source = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[\s,]+/)
      : [];
  const seen = new Set();
  const tags = [];
  for (const entry of source) {
    const trimmed = String(entry ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(trimmed);
  }
  return tags;
}

function normalizeString(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function parsePaginationParams(query, { defaultLimit = 10, maxLimit = 50 } = {}) {
  const rawLimit = query?.limit ?? defaultLimit;
  let limit = parseInt(rawLimit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  limit = Math.min(Math.max(limit, 1), maxLimit);

  const rawSkip = query?.skip ?? 0;
  let skip = parseInt(rawSkip, 10);
  if (!Number.isFinite(skip) || skip < 0) skip = 0;

  const rawCursor = query?.cursor ? String(query.cursor).trim() : null;
  let cursorId = null;
  if (rawCursor && mongoose.Types.ObjectId.isValid(rawCursor)) {
    cursorId = new mongoose.Types.ObjectId(rawCursor);
  }

  return { limit, skip, cursor: rawCursor && cursorId ? rawCursor : null, cursorId };
}

// Optional admin/dev only: create catalog item when ALLOW_CATALOG_WRITE=true
router.post("/", async (req, res) => {
  if (String(process.env.ALLOW_CATALOG_WRITE).toLowerCase() !== "true") {
    return res.status(403).json({ error: "Catalog writes disabled" });
  }

  const {
    title,
    name,
    type,
    description,
    author,
    primaryCreator,
    format,
    publisher,
    year,
    tags,
  } = req.body ?? {};

  const canonicalTitle = normalizeString(title ?? name);
  const canonicalType = normalizeString(type);

  if (!canonicalTitle || !canonicalType)
    return res.status(400).json({ error: "title and type required" });

  const item = await Collectable.create({
    title: canonicalTitle,
    type: canonicalType,
    description: normalizeString(description),
    primaryCreator: normalizeString(primaryCreator ?? author),
    format: normalizeString(format),
    publisher: normalizeString(publisher),
    year: normalizeString(year),
    tags: normalizeTags(tags),
  });

  res.status(201).json({ item });
});

// Search catalog globally
router.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const type = String(req.query.type || "").trim();
  const { limit, skip, cursor, cursorId } = parsePaginationParams(req.query);
  const baseFilter = {};
  if (type) baseFilter.type = type;
  if (q) {
    baseFilter.title = {
      $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  }

  const filter = { ...baseFilter };

  let queryBuilder = Collectable.find(filter).sort({ _id: 1 });

  if (cursorId) {
    queryBuilder = queryBuilder.where({ _id: { $gt: cursorId } });
  }

  if (skip) {
    queryBuilder = queryBuilder.skip(skip);
  }

  const docs = await queryBuilder.limit(limit + 1);
  const hasMore = docs.length > limit;
  const results = hasMore ? docs.slice(0, limit) : docs;
  const nextCursor = hasMore ? String(results[results.length - 1]._id) : null;

  const total = await Collectable.countDocuments(baseFilter);

  res.json({
    results,
    pagination: {
      limit,
      skip,
      total,
      cursor: cursor || null,
      nextCursor,
      hasMore,
      count: results.length,
    },
  });
});

// Retrieve a single collectable by id
router.get("/:collectableId", async (req, res) => {
  const collectable = await Collectable.findById(req.params.collectableId);
  if (!collectable)
    return res.status(404).json({ error: "Collectable not found" });
  res.json({ collectable });
});

// Update a collectable's core metadata
router.put("/:collectableId", async (req, res) => {
  const collectable = await Collectable.findById(req.params.collectableId);
  if (!collectable)
    return res.status(404).json({ error: "Collectable not found" });

  const body = req.body ?? {};
  const updates = {};

  if (body.title !== undefined || body.name !== undefined) {
    const nextTitle = normalizeString(body.title ?? body.name);
    if (!nextTitle)
      return res.status(400).json({ error: "title cannot be empty" });
    updates.title = nextTitle;
  }

  if (body.primaryCreator !== undefined || body.author !== undefined) {
    updates.primaryCreator = normalizeString(body.primaryCreator ?? body.author);
  }

  if (body.publisher !== undefined) {
    updates.publisher = normalizeString(body.publisher);
  }

  if (body.format !== undefined) {
    updates.format = normalizeString(body.format);
  }

  if (body.year !== undefined) {
    updates.year = normalizeString(body.year);
  }

  if (body.tags !== undefined) {
    updates.tags = normalizeTags(body.tags);
  }

  if (!Object.keys(updates).length) {
    return res.json({ collectable });
  }

  for (const [key, value] of Object.entries(updates)) {
    collectable[key] = value;
  }
  await collectable.save();

  res.json({ collectable });
});

module.exports = router;
