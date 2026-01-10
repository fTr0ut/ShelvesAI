const express = require("express");
const { auth } = require("../middleware/auth");
const collectablesQueries = require("../database/queries/collectables");
const { query } = require("../database/pg");
const { rowToCamelCase, parsePagination } = require("../database/queries/utils");

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
  try {
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

    const item = await collectablesQueries.upsert({
      title: canonicalTitle,
      kind: canonicalType,
      description: normalizeString(description),
      primaryCreator: normalizeString(primaryCreator ?? author),
      publishers: publisher ? [normalizeString(publisher)] : [],
      year: normalizeString(year),
      tags: normalizeTags(tags),
    });

    res.status(201).json({ item });
  } catch (err) {
    console.error('POST /collectables error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Search catalog globally
router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const type = String(req.query.type || "").trim();
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });

    if (!q) {
      // Return paginated list without search
      const result = await query(
        `SELECT * FROM collectables 
         ${type ? 'WHERE kind = $1' : ''}
         ORDER BY created_at DESC
         LIMIT $${type ? 2 : 1} OFFSET $${type ? 3 : 2}`,
        type ? [type, limit, offset] : [limit, offset]
      );

      const countResult = await query(
        `SELECT COUNT(*) as total FROM collectables ${type ? 'WHERE kind = $1' : ''}`,
        type ? [type] : []
      );
      const total = parseInt(countResult.rows[0].total);

      return res.json({
        results: result.rows.map(rowToCamelCase),
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + result.rows.length < total,
          count: result.rows.length,
        },
      });
    }

    // Search with trigram similarity
    const results = await collectablesQueries.searchGlobal({ q, kind: type || null, limit, offset });

    const countResult = await query(
      `SELECT COUNT(*) as total FROM collectables 
       WHERE (title % $1 OR primary_creator % $1)
       ${type ? 'AND kind = $2' : ''}`,
      type ? [q, type] : [q]
    );
    const total = parseInt(countResult.rows[0].total);

    res.json({
      results,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + results.length < total,
        count: results.length,
      },
    });
  } catch (err) {
    console.error('GET /collectables error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Retrieve a single collectable by id
router.get("/:collectableId", async (req, res) => {
  try {
    const collectable = await collectablesQueries.findById(parseInt(req.params.collectableId, 10));
    if (!collectable)
      return res.status(404).json({ error: "Collectable not found" });
    res.json({ collectable });
  } catch (err) {
    console.error('GET /collectables/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a collectable's core metadata
router.put("/:collectableId", async (req, res) => {
  try {
    const collectableId = parseInt(req.params.collectableId, 10);
    const existingResult = await query('SELECT * FROM collectables WHERE id = $1', [collectableId]);

    if (!existingResult.rows.length) {
      return res.status(404).json({ error: "Collectable not found" });
    }

    const body = req.body ?? {};
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (body.title !== undefined || body.name !== undefined) {
      const nextTitle = normalizeString(body.title ?? body.name);
      if (!nextTitle)
        return res.status(400).json({ error: "title cannot be empty" });
      updates.push(`title = $${paramIndex++}`);
      values.push(nextTitle);
    }

    if (body.primaryCreator !== undefined || body.author !== undefined) {
      updates.push(`primary_creator = $${paramIndex++}`);
      values.push(normalizeString(body.primaryCreator ?? body.author));
    }

    if (body.publisher !== undefined) {
      updates.push(`publishers = $${paramIndex++}`);
      values.push(body.publisher ? [normalizeString(body.publisher)] : []);
    }

    if (body.year !== undefined) {
      updates.push(`year = $${paramIndex++}`);
      values.push(normalizeString(body.year));
    }

    if (body.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(normalizeTags(body.tags));
    }

    if (!updates.length) {
      return res.json({ collectable: rowToCamelCase(existingResult.rows[0]) });
    }

    values.push(collectableId);
    const result = await query(
      `UPDATE collectables SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    const updated = result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
    const hydrated = updated ? await collectablesQueries.findById(updated.id) : null;
    res.json({ collectable: hydrated || updated });
  } catch (err) {
    console.error('PUT /collectables/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
