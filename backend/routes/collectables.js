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

// Optional admin/dev only: create catalog item when ALLOW_CATALOG_WRITE=true
router.post("/", async (req, res) => {
  if (String(process.env.ALLOW_CATALOG_WRITE).toLowerCase() !== "true") {
    return res.status(403).json({ error: "Catalog writes disabled" });
  }

  const {
    name,
    type,
    description,
    author,
    format,
    publisher,
    year,
    position,
    tags,
  } = req.body ?? {};

  if (!name || !type)
    return res.status(400).json({ error: "name and type required" });

  const normalizedPosition =
    position != null ? String(position).trim() : undefined;
  const normalizedTags = normalizeTags(tags);

  const item = await Collectable.create({
    name,
    type,
    description,
    author,
    format,
    publisher,
    year,
    position: normalizedPosition || undefined,
    tags: normalizedTags,
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
    filter.name = {
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

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return res.status(400).json({ error: "name cannot be empty" });
    updates.name = name;
  }

  if (body.author !== undefined) {
    const value = String(body.author || "").trim();
    updates.author = value || undefined;
  }

  if (body.publisher !== undefined) {
    const value = String(body.publisher || "").trim();
    updates.publisher = value || undefined;
  }

  if (body.format !== undefined) {
    const value = String(body.format || "").trim();
    updates.format = value || undefined;
  }

  if (body.year !== undefined) {
    const value = String(body.year || "").trim();
    updates.year = value || undefined;
  }

  if (body.position !== undefined) {
    const value = String(body.position || "").trim();
    updates.position = value || undefined;
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
