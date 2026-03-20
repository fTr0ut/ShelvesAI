# Task 007: Backfill Existing Collectables with Metascore

## Context

The `metascore` JSONB column exists on `collectables` but is null for all existing rows. We need a one-time script that scores every existing collectable and writes the result.

## Objective

Create a standalone Node.js script that:
1. Reads all collectables from the database in batches
2. Scores each one using `MetadataScorer`
3. Writes the `metascore` JSONB back to the row
4. Logs progress and summary statistics

## Scope

**Single new file:** `api/scripts/backfillMetascore.js`

### Implementation

The script should:

1. **Load environment** — `require('dotenv').config()` to get DB credentials.
2. **Import dependencies:**
   - `const { query } = require('../database/pg')`
   - `const { MetadataScorer } = require('../services/catalog/MetadataScorer')`
   - `const { getApiContainerKey } = require('../services/config/shelfTypeResolver')`
   - `const { rowToCamelCase } = require('../database/queries/utils')`
3. **Process in batches** of 500 rows:
   - `SELECT id, kind, title, primary_creator, creators, publishers, year, description, cover_url, cover_image_url, images, identifiers, tags, genre, runtime, system_name, extras FROM collectables WHERE metascore IS NULL ORDER BY id LIMIT 500 OFFSET $1`
   - For each row, convert to camelCase, resolve `containerType` via `getApiContainerKey(row.kind)`, call `scorer.score(row, containerType)`, then UPDATE the row.
4. **Batch UPDATE** — Use a single UPDATE statement per batch for efficiency:
   - Build a VALUES list and use `UPDATE collectables SET metascore = v.metascore::jsonb, updated_at = NOW() FROM (VALUES ($1::int, $2::jsonb), ...) AS v(id, metascore) WHERE collectables.id = v.id`
5. **Log progress** — Every batch, log: `[Backfill] Processed N/total (X scored, Y skipped — no container type)`
6. **Summary** — At the end, log total processed, scored, skipped, and elapsed time.
7. **Exit cleanly** — Call `process.exit(0)` on success, `process.exit(1)` on error.

### Running the script

```bash
cd api
node scripts/backfillMetascore.js
```

### Edge cases

- Collectables with `kind = 'other'` or `kind = 'item'` will have `getApiContainerKey()` return `null`. Score them with `containerType = null` — `MetadataScorer.score()` returns `{ score: null, ... }` for unknown types. Still write this to the DB so the row is marked as processed (metascore is no longer null).
- Collectables with `kind = null` — treat as unknown, same as above.
- Parse `images`, `identifiers`, `tags`, `genre` from JSONB — they come back as objects/arrays from pg, no need to JSON.parse.
- The `extras` column may not exist on the table (it's stored in the JSONB `sources` or `identifiers` depending on the collectable). Check if the column exists; if not, skip it. Actually — looking at the collectables table, there is no `extras` column. The extras are embedded in the collectable payload but not stored as a separate column. So the scorer won't have access to `extras.certification` etc. for existing rows. That's fine — those fields will just be scored as missing. Future upserts will include the full payload.

## Non-goals

- No dry-run mode (the script is idempotent — running it twice is safe because it only processes rows where `metascore IS NULL`).
- No parallelism (sequential batches are fine for a one-time backfill).

## Constraints

- The script must work with the existing database schema (no new columns beyond `metascore`).
- Must handle large tables (10k+ rows) without running out of memory — hence batch processing.
- Must not lock the table for extended periods — batch UPDATEs are small (500 rows).
