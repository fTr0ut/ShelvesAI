# Component 6: Needs Review Queue

## Objective
Create infrastructure for storing and processing low-confidence vision results that require user review before adding to the database.

---

## Database Migration

### New File: `api/database/migrations/xxx_create_needs_review.js`

```javascript
exports.up = async function(knex) {
  await knex.schema.createTable('needs_review', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.integer('shelf_id').notNullable().references('id').inTable('shelves').onDelete('CASCADE');
    table.jsonb('raw_data').notNullable();
    table.decimal('confidence', 3, 2);
    table.string('status', 20).defaultTo('pending'); // pending, completed, dismissed
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index(['user_id', 'status']);
    table.index(['shelf_id', 'status']);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('needs_review');
};
```

---

## Database Queries

### New File: `api/database/queries/needsReview.js`

```javascript
const { query } = require('../pg');
const { rowToCamelCase } = require('./utils');

async function create({ userId, shelfId, rawData, confidence }) {
  const result = await query(
    `INSERT INTO needs_review (user_id, shelf_id, raw_data, confidence)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, shelfId, JSON.stringify(rawData), confidence]
  );
  return rowToCamelCase(result.rows[0]);
}

async function listPending(userId, shelfId) {
  const result = await query(
    `SELECT * FROM needs_review 
     WHERE user_id = $1 AND shelf_id = $2 AND status = 'pending'
     ORDER BY created_at DESC`,
    [userId, shelfId]
  );
  return result.rows.map(rowToCamelCase);
}

async function getById(id, userId) {
  const result = await query(
    `SELECT * FROM needs_review WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function markCompleted(id, userId) {
  const result = await query(
    `UPDATE needs_review SET status = 'completed', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function dismiss(id, userId) {
  const result = await query(
    `UPDATE needs_review SET status = 'dismissed', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

module.exports = { create, listPending, getById, markCompleted, dismiss };
```

---

## API Routes

### Modify: `api/routes/shelves.js`

```javascript
// GET /api/shelves/:shelfId/review - List pending review items
router.get('/:shelfId/review', auth, shelvesController.listReviewItems);

// POST /api/shelves/:shelfId/review/:id/complete - Complete and add to shelf
router.post('/:shelfId/review/:id/complete', auth, shelvesController.completeReviewItem);

// DELETE /api/shelves/:shelfId/review/:id - Dismiss review item
router.delete('/:shelfId/review/:id', auth, shelvesController.dismissReviewItem);
```

---

## Controller Methods

### Add to: `api/controllers/shelvesController.js`

```javascript
const needsReviewQueries = require('../database/queries/needsReview');

async function listReviewItems(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });
    
    const items = await needsReviewQueries.listPending(req.user.id, shelf.id);
    res.json({ items });
  } catch (err) {
    console.error('listReviewItems error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function completeReviewItem(req, res) {
  try {
    const shelf = await loadShelfForUser(req.user.id, req.params.shelfId);
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });
    
    const reviewItem = await needsReviewQueries.getById(req.params.id, req.user.id);
    if (!reviewItem) return res.status(404).json({ error: "Review item not found" });
    
    // Merge user edits with raw data
    const completedData = { ...reviewItem.rawData, ...req.body };
    
    // RE-MATCH: Run fingerprint + fuzzy match to prevent duplicates
    const lwf = makeLightweightFingerprint(completedData);
    let collectable = await collectablesQueries.findByLightweightFingerprint(lwf);
    
    if (!collectable) {
      collectable = await collectablesQueries.fuzzyMatch(
        completedData.title,
        completedData.primaryCreator,
        shelf.type
      );
    }
    
    if (!collectable) {
      // No match found - create new collectable
      collectable = await collectablesQueries.upsert({
        ...completedData,
        kind: shelf.type,
        fingerprint: makeCollectableFingerprint(completedData),
        lightweightFingerprint: lwf,
      });
    }
    
    // Add to user's shelf
    const item = await shelvesQueries.addCollectable({
      userId: req.user.id,
      shelfId: shelf.id,
      collectableId: collectable.id,
    });
    
    // Mark review item as completed
    await needsReviewQueries.markCompleted(reviewItem.id, req.user.id);
    
    // Log event
    await logShelfEvent({
      userId: req.user.id,
      shelfId: shelf.id,
      type: "item.collectable_added",
      payload: { source: "review", reviewItemId: reviewItem.id },
    });
    
    res.json({ item: { id: item.id, collectable } });
  } catch (err) {
    console.error('completeReviewItem error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function dismissReviewItem(req, res) {
  try {
    const result = await needsReviewQueries.dismiss(req.params.id, req.user.id);
    if (!result) return res.status(404).json({ error: "Review item not found" });
    res.json({ dismissed: true, id: req.params.id });
  } catch (err) {
    console.error('dismissReviewItem error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}
```

---

## Complete Flow (Re-Matching)

When user completes a review item:

```
1. User submits completed data → POST /review/:id/complete
2. Merge user edits with original raw_data
3. Generate lightweight fingerprint
4. Check findByLightweightFingerprint() → if match, use existing
5. Else check fuzzyMatch() → if match above threshold, use existing
6. Else upsert new collectable
7. Add collectable to user_collections
8. Mark needs_review item as 'completed'
9. Return the added item
```

**This prevents duplicates even after user edits the data.**

---

## Export Controller Methods

```javascript
module.exports = {
  // ... existing exports
  listReviewItems,
  completeReviewItem,
  dismissReviewItem,
};
```

---

## Testing

```bash
npm test -- needsReview
```

**Test cases:**
1. Create review item stores raw data correctly
2. List returns only pending items for user/shelf
3. Complete triggers re-matching before adding
4. Existing collectable is linked (not duplicated)
5. New collectable is created when no match
6. Dismiss marks status as 'dismissed'

---

## Acceptance Criteria
- [ ] `needs_review` table migration created
- [ ] `needsReview.js` queries file created
- [ ] Three API endpoints working (list, complete, dismiss)
- [ ] Complete endpoint runs fingerprint + fuzzy matching
- [ ] Duplicates prevented via re-matching step
- [ ] Unit tests pass
