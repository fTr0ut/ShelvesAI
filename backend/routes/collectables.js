const express = require("express");
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
    position,
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
    position: normalizeString(position),
    tags: normalizeTags(tags),
  });

  res.status(201).json({ item });
});

// Search catalog globally
router.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const type = String(req.query.type || "").trim();
  const limit = Math.min(parseInt(req.query.limit || "10", 10), 50);
  const filter = {};
  if (type) filter.type = type;
  if (q)
    filter.title = {
      $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  const results = await Collectable.find(filter).limit(limit);
  res.json({ results });
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

  if (body.position !== undefined) {
    updates.position = normalizeString(body.position);
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
