# Component 5: Database Matching

## Objective
Add fuzzy matching capability to the collectables database queries to prevent duplicate entries.

## File to Modify

### `api/database/queries/collectables.js`

---

## New Function: `fuzzyMatch`

```javascript
/**
 * Find a collectable using fuzzy matching on title and creator.
 * Uses PostgreSQL pg_trgm extension for similarity matching.
 * 
 * @param {string} title - Item title to match
 * @param {string} primaryCreator - Creator/author to match
 * @param {string} kind - Type filter (book, game, movie)
 * @param {number} threshold - Minimum similarity score (0.0-1.0), default 0.3
 * @returns {Promise<Object|null>} Best matching collectable or null
 */
async function fuzzyMatch(title, primaryCreator, kind, threshold = 0.3) {
  if (!title) return null;
  
  let sql = `
    SELECT *,
           similarity(title, $1) AS title_sim,
           similarity(COALESCE(primary_creator, ''), $2) AS creator_sim,
           (similarity(title, $1) * 0.7 + similarity(COALESCE(primary_creator, ''), $2) * 0.3) AS combined_sim
    FROM collectables
    WHERE similarity(title, $1) > $3
  `;
  const params = [title, primaryCreator || '', threshold];
  
  if (kind) {
    sql += ` AND kind = $4`;
    params.push(kind);
  }
  
  sql += ` ORDER BY combined_sim DESC LIMIT 1`;
  
  const result = await query(sql, params);
  
  if (result.rows.length && result.rows[0].combined_sim >= threshold) {
    return rowToCamelCase(result.rows[0]);
  }
  return null;
}
```

---

## Matching Strategy

The pipeline uses a two-step matching approach:

### Step 1: Exact Fingerprint Match
```javascript
const lwf = makeLightweightFingerprint({ title, primaryCreator, kind });
const exact = await collectablesQueries.findByLightweightFingerprint(lwf);
if (exact) return exact;
```

### Step 2: Fuzzy Match (if no exact match)
```javascript
const fuzzy = await collectablesQueries.fuzzyMatch(title, primaryCreator, kind);
if (fuzzy) return fuzzy;
```

### Step 3: Create New (if no match)
```javascript
return await collectablesQueries.upsert(newCollectable);
```

---

## Similarity Weighting

| Field | Weight | Rationale |
|-------|--------|-----------|
| Title | 70% | Most important identifier |
| Creator | 30% | Helps disambiguate |

Combined score threshold: **0.3** (30% minimum similarity)

---

## Required PostgreSQL Extension

Ensure `pg_trgm` extension is enabled:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Also ensure GIN index exists for performance:
```sql
CREATE INDEX IF NOT EXISTS idx_collectables_title_trgm 
ON collectables USING gin (title gin_trgm_ops);
```

---

## Export Updated Module

```javascript
module.exports = {
  findByFingerprint,
  findByLightweightFingerprint,
  findById,
  searchByTitle,
  upsert,
  searchGlobal,
  fuzzyMatch,  // NEW
};
```

---

## Testing

```bash
npm test -- collectables -- --grep "fuzzy"
```

**Test cases:**
1. Exact match returns existing collectable
2. Fuzzy match "The Hobit" finds "The Hobbit"
3. OCR error "Lord of tbe Rings" matches "Lord of the Rings"
4. Different author with same title does NOT match (below threshold)
5. Returns null when no match above threshold

---

## Acceptance Criteria
- [ ] `fuzzyMatch()` function added to collectables queries
- [ ] Uses pg_trgm similarity with configurable threshold
- [ ] Combined title/creator scoring (70/30 weight)
- [ ] GIN index recommendation documented
- [ ] Unit tests for fuzzy matching edge cases
